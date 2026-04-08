import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import {
  DEFAULT_TESTNET_RPC_URL,
  DEFAULT_TOKEN_DECIMALS,
  STELLAR_ASSET_ADDRESS_REGEX,
  STELLAR_DESTINATION_ADDRESS_REGEX,
  STELLAR_NETWORK_TO_PASSPHRASE,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  USDC_PUBNET_ADDRESS,
  USDC_TESTNET_ADDRESS,
} from "./constants.js";
import type { Network } from "@x402/core/types";

export const DEFAULT_ESTIMATED_LEDGER_SECONDS = 5;
const RPC_LEDGERS_SAMPLE_SIZE = 20;

export interface RpcConfig {
  url?: string;
}

export function isStellarNetwork(network: Network): boolean {
  return STELLAR_NETWORK_TO_PASSPHRASE.has(network);
}

export function validateStellarDestinationAddress(address: string): boolean {
  return STELLAR_DESTINATION_ADDRESS_REGEX.test(address);
}

export function validateStellarAssetAddress(address: string): boolean {
  return STELLAR_ASSET_ADDRESS_REGEX.test(address);
}

export function getNetworkPassphrase(network: Network): string {
  const networkPassphrase = STELLAR_NETWORK_TO_PASSPHRASE.get(network);
  if (!networkPassphrase) {
    throw new Error(`Unknown Stellar network: ${network}`);
  }
  return networkPassphrase;
}

export function getRpcUrl(network: Network, rpcConfig?: RpcConfig): string {
  const customRpcUrl = rpcConfig?.url;
  switch (network) {
    case STELLAR_TESTNET_CAIP2:
      return customRpcUrl || DEFAULT_TESTNET_RPC_URL;
    case STELLAR_PUBNET_CAIP2:
      return customRpcUrl || "https://soroban-rpc.mainnet.stellar.org";
    default:
      throw new Error(`Unknown Stellar network: ${network}`);
  }
}

export function getRpcClient(network: Network, rpcConfig?: RpcConfig): rpc.Server {
  const rpcUrl = getRpcUrl(network, rpcConfig);
  return new rpc.Server(rpcUrl, {
    allowHttp: network === STELLAR_TESTNET_CAIP2,
  });
}

export async function getEstimatedLedgerCloseTimeSeconds(server: rpc.Server): Promise<number> {
  try {
    const latestLedger = await server.getLatestLedger();
    const startLedger = latestLedger.sequence;
    const { ledgers } = await server.getLedgers({
      startLedger,
      pagination: { limit: RPC_LEDGERS_SAMPLE_SIZE },
    });
    if (!ledgers || ledgers.length < 2) return DEFAULT_ESTIMATED_LEDGER_SECONDS;

    const oldestTs = parseInt(ledgers[0].ledgerCloseTime);
    const newestTs = parseInt(ledgers[ledgers.length - 1].ledgerCloseTime);
    const intervals = ledgers.length - 1;
    return Math.ceil((newestTs - oldestTs) / intervals);
  } catch {
    return DEFAULT_ESTIMATED_LEDGER_SECONDS;
  }
}

export function getUsdcAddress(network: Network): string {
  switch (network) {
    case STELLAR_PUBNET_CAIP2:
      return USDC_PUBNET_ADDRESS;
    case STELLAR_TESTNET_CAIP2:
      return USDC_TESTNET_ADDRESS;
    default:
      throw new Error(`No USDC address configured for network: ${network}`);
  }
}

export function convertToTokenAmount(
  decimalAmount: string,
  decimals: number = DEFAULT_TOKEN_DECIMALS,
): string {
  const amount = parseFloat(decimalAmount);
  if (isNaN(amount)) {
    throw new Error(`Invalid amount: ${decimalAmount}`);
  }
  if (decimals < 0 || decimals > 20) {
    throw new Error(`Decimals must be between 0 and 20, got ${decimals}`);
  }
  const normalizedDecimal = /[eE]/.test(decimalAmount)
    ? amount.toFixed(Math.max(decimals, 20))
    : decimalAmount;
  const [intPart, decPart = ""] = normalizedDecimal.split(".");
  const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
  return (intPart + paddedDec).replace(/^0+/, "") || "0";
}
export async function resolveTransactionHash(
  currentHash: string, 
  payerAddress: string, 
  network: Network
): Promise<string> {
  if (currentHash && currentHash !== "pending" && currentHash.length === 64) {
    return currentHash;
  }

  // Hyper-active polling for x402/Soroban latency
  const MAX_ATTEMPTS = 5;
  const ATTEMPT_DELAY_MS = 3000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Linear delay backoff: 3s, 6s, 9s...
      await new Promise(resolve => setTimeout(resolve, ATTEMPT_DELAY_MS));

      const horizonUrl = network === STELLAR_PUBNET_CAIP2 
        ? "https://horizon.stellar.org" 
        : "https://horizon-testnet.stellar.org";
      
      // Simultaneous polling of Transactions AND Operations for faster capture
      const [txRes, opRes] = await Promise.all([
        fetch(`${horizonUrl}/accounts/${payerAddress}/transactions?limit=3&order=desc`),
        fetch(`${horizonUrl}/accounts/${payerAddress}/operations?limit=3&order=desc`)
      ]);

      if (txRes.ok) {
        const txData: any = await txRes.json();
        for (const tx of txData._embedded?.records || []) {
          if (Math.abs(Date.now() - new Date(tx.created_at).getTime()) < 240000) {
            return tx.hash;
          }
        }
      }

      if (opRes.ok) {
        const opData: any = await opRes.json();
        for (const op of opData._embedded?.records || []) {
          if (Math.abs(Date.now() - new Date(op.created_at).getTime()) < 240000) {
            return op.transaction_hash;
          }
        }
      }
    } catch (err) {
      // Quiet fail for polling
    }
  }

  return currentHash || "pending";
}

/**
 * Decodes a payment response header natively (x402 or MPP).
 * Handles both raw JSON and Base64-encoded JSON envelopes.
 */
export function decodeAuthoraPaymentHeader<T = any>(headerValue: string | null | undefined): T | undefined {
  if (!headerValue) return undefined;
  try {
    const trimmed = headerValue.trim();
    
    // Handle raw JSON
    if (trimmed.startsWith("{")) {
       return JSON.parse(trimmed) as T;
    }
    
    // Base64 decoding (Native Node.js / Buffer)
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    return JSON.parse(decoded) as T;
  } catch (e) {
    return undefined;
  }
}

/**
 * Autonomous Swap: XLM -> USDC
 * High-impact demonstration of agentic liquidity management.
 */
export async function swapXlmToUsdc(
  secretKey: string,
  xlmAmount: string
): Promise<{ hash: string; usdcReceived: string }> {
  try {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(secretKey);
    const server = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

    // Official Circle Testnet USDC
    const USDC_ASSET = new StellarSdk.Asset(
      "USDC",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    );

    // Path Payment: We specify exactly how much native XLM to spend to get USDC
    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.pathPaymentStrictSend({
          sendAsset: StellarSdk.Asset.native(),
          sendAmount: xlmAmount,
          destination: sourceKeypair.publicKey(),
          destAsset: USDC_ASSET,
          destMin: "0.0001", // Very low minimum for demonstration
          path: [], // Horizon will find the best path
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);
    const result = await server.submitTransaction(transaction);
    
    return {
      hash: result.hash,
      usdcReceived: "converted" // Simplified for tool output
    };
  } catch (e: any) {
    throw new Error(`Swap failed: ${e.message}`);
  }
}

/**
 * Add USDC Trustline to an account
 */
export async function addUsdcTrustline(
  secretKey: string
): Promise<{ hash: string }> {
  try {
    const keypair = StellarSdk.Keypair.fromSecret(secretKey);
    const server = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");
    const account = await server.loadAccount(keypair.publicKey());

    const USDC_ASSET = new StellarSdk.Asset(
      "USDC",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    );

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.changeTrust({
          asset: USDC_ASSET,
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(keypair);
    const result = await server.submitTransaction(transaction);
    return { hash: result.hash };
  } catch (e: any) {
    throw new Error(`Trustline failed: ${e.message}`);
  }
}

/**
 * Atomic Multi-Transfer
 * Batches multiple payment operations into a single transaction.
 */
export async function multiTransfer(
  secretKey: string,
  transfers: Array<{ recipient: string, amount: string, assetCode?: string }>
): Promise<{ hash: string }> {
  try {
    const keypair = StellarSdk.Keypair.fromSecret(secretKey);
    const server = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");
    const account = await server.loadAccount(keypair.publicKey());

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    });

    for (const t of transfers) {
      // Default to Native (XLM)
      let asset = StellarSdk.Asset.native();
      if (t.assetCode && t.assetCode !== "XLM") {
        asset = new StellarSdk.Asset(
          t.assetCode,
          "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        );
      }

      txBuilder.addOperation(
        StellarSdk.Operation.payment({
          destination: t.recipient,
          asset,
          amount: t.amount,
        })
      );
    }

    const transaction = txBuilder.setTimeout(30).build();
    transaction.sign(keypair);
    const result = await server.submitTransaction(transaction);
    return { hash: result.hash };
  } catch (e: any) {
    throw new Error(`Multi-transfer failed: ${e.message}`);
  }
}

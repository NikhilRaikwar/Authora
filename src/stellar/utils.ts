/**
 * stellar/utils.ts - Fixed version
 *
 * FIXES:
 *  1. resolveTransactionHash now polls both /transactions and /payments endpoints
 *  2. decodeAuthoraPaymentHeader handles all OZ facilitator response formats
 *  3. swapXlmToUsdc uses correct DEX path payment
 */

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
  const passphrase = STELLAR_NETWORK_TO_PASSPHRASE.get(network);
  if (!passphrase) throw new Error(`Unknown Stellar network: ${network}`);
  return passphrase;
}

export function getRpcUrl(network: Network, rpcConfig?: RpcConfig): string {
  if (rpcConfig?.url) return rpcConfig.url;
  switch (network) {
    case STELLAR_TESTNET_CAIP2:
      return DEFAULT_TESTNET_RPC_URL;
    case STELLAR_PUBNET_CAIP2:
      return "https://soroban-rpc.mainnet.stellar.org";
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

export async function getEstimatedLedgerCloseTimeSeconds(
  server: rpc.Server,
): Promise<number> {
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
    return Math.ceil((newestTs - oldestTs) / (ledgers.length - 1));
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
      throw new Error(`No USDC address for network: ${network}`);
  }
}

export function convertToTokenAmount(
  decimalAmount: string,
  decimals: number = DEFAULT_TOKEN_DECIMALS,
): string {
  const amount = parseFloat(decimalAmount);
  if (isNaN(amount)) throw new Error(`Invalid amount: ${decimalAmount}`);
  const [intPart, decPart = ""] = decimalAmount.split(".");
  const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
  return (intPart + paddedDec).replace(/^0+/, "") || "0";
}

/**
 * Resolve a pending/unknown transaction hash by polling Horizon.
 * Tries transactions, operations, and payments endpoints.
 */
export async function resolveTransactionHash(
  currentHash: string,
  payerAddress: string,
  network: Network,
): Promise<string> {
  // Already have a valid 64-char hex hash
  if (
    currentHash &&
    currentHash !== "pending" &&
    currentHash.length === 64 &&
    /^[0-9a-fA-F]+$/.test(currentHash)
  ) {
    return currentHash;
  }

  const horizonUrl =
    network === STELLAR_PUBNET_CAIP2
      ? "https://horizon.stellar.org"
      : "https://horizon-testnet.stellar.org";

  const MAX_ATTEMPTS = 6;
  const DELAY_MS = 3000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, DELAY_MS));

    try {
      // Check payments endpoint (catches SAC transfers)
      const paymentsRes = await fetch(
        `${horizonUrl}/accounts/${payerAddress}/payments?limit=5&order=desc`,
      );
      if (paymentsRes.ok) {
        const data: any = await paymentsRes.json();
        for (const record of data._embedded?.records || []) {
          const age = Date.now() - new Date(record.created_at).getTime();
          if (age < 120_000) {
            // within 2 minutes
            return record.transaction_hash;
          }
        }
      }

      // Check operations endpoint
      const opsRes = await fetch(
        `${horizonUrl}/accounts/${payerAddress}/operations?limit=5&order=desc`,
      );
      if (opsRes.ok) {
        const data: any = await opsRes.json();
        for (const record of data._embedded?.records || []) {
          const age = Date.now() - new Date(record.created_at).getTime();
          if (age < 120_000) {
            return record.transaction_hash;
          }
        }
      }

      // Check transactions endpoint
      const txRes = await fetch(
        `${horizonUrl}/accounts/${payerAddress}/transactions?limit=5&order=desc`,
      );
      if (txRes.ok) {
        const data: any = await txRes.json();
        for (const record of data._embedded?.records || []) {
          const age = Date.now() - new Date(record.created_at).getTime();
          if (age < 120_000) {
            return record.hash;
          }
        }
      }
    } catch {
      // Silent fail — keep polling
    }
  }

  return currentHash || "pending";
}

/**
 * Decode a payment response header from OZ x402 facilitator or MPP.
 * Handles: raw JSON, base64-encoded JSON, plain hash strings.
 */
export function decodeAuthoraPaymentHeader<T = any>(
  headerValue: string | null | undefined,
): T | undefined {
  if (!headerValue) return undefined;

  try {
    const trimmed = headerValue.trim();

    // Raw JSON
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return JSON.parse(trimmed) as T;
    }

    // Base64-encoded JSON
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf8");
      if (decoded.startsWith("{") || decoded.startsWith("[")) {
        return JSON.parse(decoded) as T;
      }
    } catch {
      // Not base64
    }

    // Plain 64-char hex hash
    if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
      return { transaction: trimmed } as unknown as T;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

// ── Wallet Utilities ──────────────────────────────────────────────────────────

export async function swapXlmToUsdc(
  secretKey: string,
  xlmAmount: string,
): Promise<{ hash: string; usdcReceived: string }> {
  const sourceKeypair = StellarSdk.Keypair.fromSecret(secretKey);
  const server = new StellarSdk.Horizon.Server(
    "https://horizon-testnet.stellar.org",
  );
  const account = await server.loadAccount(sourceKeypair.publicKey());

  const USDC_ASSET = new StellarSdk.Asset(
    "USDC",
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  );

  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.pathPaymentStrictSend({
        sendAsset: StellarSdk.Asset.native(),
        sendAmount: xlmAmount,
        destination: sourceKeypair.publicKey(),
        destAsset: USDC_ASSET,
        destMin: "0.0001",
        path: [],
      }),
    )
    .setTimeout(30)
    .build();

  transaction.sign(sourceKeypair);
  const result = await server.submitTransaction(transaction);
  return { hash: result.hash, usdcReceived: "converted" };
}

export async function addUsdcTrustline(
  secretKey: string,
): Promise<{ hash: string }> {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const server = new StellarSdk.Horizon.Server(
    "https://horizon-testnet.stellar.org",
  );
  const account = await server.loadAccount(keypair.publicKey());

  const USDC_ASSET = new StellarSdk.Asset(
    "USDC",
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  );

  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(30)
    .build();

  transaction.sign(keypair);
  const result = await server.submitTransaction(transaction);
  return { hash: result.hash };
}

export async function multiTransfer(
  secretKey: string,
  transfers: Array<{
    recipient: string;
    amount: string;
    assetCode?: string;
  }>,
): Promise<{ hash: string }> {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const server = new StellarSdk.Horizon.Server(
    "https://horizon-testnet.stellar.org",
  );
  const account = await server.loadAccount(keypair.publicKey());

  const txBuilder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  });

  for (const t of transfers) {
    const asset =
      !t.assetCode || t.assetCode === "XLM"
        ? StellarSdk.Asset.native()
        : new StellarSdk.Asset(
            t.assetCode,
            "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          );

    txBuilder.addOperation(
      StellarSdk.Operation.payment({
        destination: t.recipient,
        asset,
        amount: t.amount,
      }),
    );
  }

  const transaction = txBuilder.setTimeout(30).build();
  transaction.sign(keypair);
  const result = await server.submitTransaction(transaction);
  return { hash: result.hash };
}

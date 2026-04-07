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
      if (!customRpcUrl) {
        throw new Error("Stellar mainnet requires a non-empty rpcUrl.");
      }
      return customRpcUrl;
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

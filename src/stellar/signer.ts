import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner, SignAuthEntry, SignTransaction } from "@stellar/stellar-sdk/contract";
import { STELLAR_TESTNET_CAIP2 } from "./constants.js";
import { getNetworkPassphrase } from "./utils.js";
import type { Network } from "@x402/core/types";

/**
 * Ed25519 signer for Stellar transactions and auth entries.
 */
export type Ed25519Signer = {
  address: string;
  signAuthEntry: SignAuthEntry;
  signTransaction: SignTransaction;
};

export type FacilitatorStellarSigner = Ed25519Signer;

export type ClientStellarSigner = {
  address: string;
  signAuthEntry: SignAuthEntry;
  signTransaction?: SignTransaction;
};

/**
 * Creates an Ed25519 signer for the given Stellar network.
 */
export function createEd25519Signer(
  privateKey: string,
  defaultNetwork: Network = STELLAR_TESTNET_CAIP2,
): Ed25519Signer {
  const kp = Keypair.fromSecret(privateKey);
  const networkPassphrase = getNetworkPassphrase(defaultNetwork);

  const address = kp.publicKey();
  const { signAuthEntry, signTransaction } = basicNodeSigner(kp, networkPassphrase);

  return {
    address,
    signAuthEntry,
    signTransaction,
  };
}

export function isFacilitatorStellarSigner(signer: unknown): signer is FacilitatorStellarSigner {
  if (typeof signer !== "object" || signer === null) return false;
  const s = signer as Record<string, unknown>;
  return (
    typeof s.address === "string" &&
    typeof s.signAuthEntry === "function" &&
    typeof s.signTransaction === "function"
  );
}

export function isClientStellarSigner(signer: unknown): signer is ClientStellarSigner {
  if (typeof signer !== "object" || signer === null) return false;
  const s = signer as Record<string, unknown>;
  return (
    typeof s.address === "string" &&
    typeof s.signAuthEntry === "function" &&
    (s.signTransaction === undefined || typeof s.signTransaction === "function")
  );
}

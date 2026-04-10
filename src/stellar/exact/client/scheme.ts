/**
 * ExactStellarScheme - Production x402 payment scheme for Stellar
 *
 * DEFINITIVE ROOT CAUSE (found by reading the official @x402/stellar package source):
 *   The official implementation does NOT pass `publicKey` to AssembledTransaction.build().
 *   When publicKey IS passed (our old code), the Stellar SDK simulates the tx AS the wallet,
 *   and the USDC SAC returns sorobanCredentialsSourceAccount (no separate auth needed).
 *   When publicKey is OMITTED, the SDK simulates without a source account, and the USDC SAC
 *   correctly returns sorobanCredentialsAddress entries that can be signed individually.
 *
 * This matches the official flow from the installed @x402/stellar package:
 *   1. Build WITHOUT publicKey (forces sorobanCredentialsAddress auth)
 *   2. signAuthEntries() — works because entries are now the right type
 *   3. Re-simulate after signing (official package does this too)
 *   4. Return XDR — facilitator fee-bumps and settles
 *
 * Canonical SAC override: legacy servers send archived CCW67... contract.
 *   We always use CBIELTK... on testnet.
 */

import {
  nativeToScVal,
  contract,
} from "@stellar/stellar-sdk";

import { handleSimulationResult } from "../../shared.js";
import {
  getEstimatedLedgerCloseTimeSeconds,
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
  isStellarNetwork,
  RpcConfig,
  validateStellarAssetAddress,
  validateStellarDestinationAddress,
} from "../../utils.js";
import type { ClientStellarSigner } from "../../signer.js";
import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from "@x402/core/types";

export class ExactStellarScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  constructor(
    private readonly signer: ClientStellarSigner,
    private readonly rpcConfig?: RpcConfig,
  ) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    this.validateInput(paymentRequirements);

    const sourcePublicKey = this.signer.address;
    let { network, payTo, asset, amount, maxTimeoutSeconds } = paymentRequirements;

    // CANONICAL OVERRIDE: Always use the active testnet USDC SAC.
    // Legacy servers (e.g. Vercel observatory) send the archived CCW67... contract.
    const CANONICAL_USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    if (network.toLowerCase().includes("testnet") && asset !== CANONICAL_USDC_SAC) {
      console.error(`[x402] Canonical SAC override: ${CANONICAL_USDC_SAC} (was ${asset})`);
      asset = CANONICAL_USDC_SAC;
    }

    const networkPassphrase = getNetworkPassphrase(network);
    const rpcUrl = getRpcUrl(network, this.rpcConfig);
    const rpcServer = getRpcClient(network, this.rpcConfig);

    const latestLedger = await rpcServer.getLatestLedger();
    const currentLedger = latestLedger.sequence;
    const estimatedLedgerSeconds = await getEstimatedLedgerCloseTimeSeconds(rpcServer);
    const maxLedger = currentLedger + Math.ceil((maxTimeoutSeconds ?? 300) / estimatedLedgerSeconds);

    // OFFICIAL FIX: Do NOT pass `publicKey` — this forces the simulation to return
    // sorobanCredentialsAddress auth entries (signable individually) instead of
    // sorobanCredentialsSourceAccount (which signAuthEntries() cannot handle).
    const tx = await contract.AssembledTransaction.build({
      contractId: asset,
      method: "transfer",
      args: [
        nativeToScVal(sourcePublicKey, { type: "address" }),
        nativeToScVal(payTo, { type: "address" }),
        nativeToScVal(BigInt(amount), { type: "i128" }),
      ],
      networkPassphrase,
      rpcUrl,
      // ⚠️  publicKey intentionally OMITTED — see class docstring above
      parseResultXdr: (result) => result,
    });

    handleSimulationResult(tx.simulation);

    // Verify our wallet is the expected signer
    const missingSigners = tx.needsNonInvokerSigningBy();
    console.error(`[x402] Signers needed: [${missingSigners.join(", ")}]`);
    if (!missingSigners.includes(sourcePublicKey)) {
      throw new Error(
        `Expected to sign with [${sourcePublicKey}], but got [${missingSigners.join(", ")}]`,
      );
    }

    // Sign individual auth entries (sorobanCredentialsAddress — correct type now)
    await tx.signAuthEntries({
      address: sourcePublicKey,
      signAuthEntry: this.signer.signAuthEntry,
      expiration: maxLedger,
    });
    console.error(`[x402] Auth entries signed ✅`);

    // Re-simulate after signing (matches official @x402/stellar implementation)
    await tx.simulate();
    handleSimulationResult(tx.simulation);

    const remaining = tx.needsNonInvokerSigningBy();
    if (remaining.length > 0) {
      throw new Error(`Unexpected remaining signers: [${remaining.join(", ")}]`);
    }

    console.error(`[x402] Payload ready: ${tx.built!.toXDR().slice(0, 40)}...`);

    return {
      x402Version,
      payload: {
        transaction: tx.built!.toXDR(),
      },
    };
  }

  private validateInput(paymentRequirements: PaymentRequirements): void {
    const { scheme, network, payTo, asset, amount } = paymentRequirements;

    if (typeof amount !== "string" || isNaN(Number(amount)) || Number(amount) <= 0) {
      throw new Error(`Invalid amount: ${amount}`);
    }
    if (scheme !== "exact") {
      throw new Error(`Unsupported scheme: ${scheme}`);
    }
    if (!isStellarNetwork(network)) {
      throw new Error(`Unsupported network: ${network}`);
    }
    if (!validateStellarDestinationAddress(payTo)) {
      throw new Error(`Invalid payTo address: ${payTo}`);
    }
    // On testnet, asset override happens after validation — skip for legacy addresses
    const isTestnet = network.toLowerCase().includes("testnet");
    if (!validateStellarAssetAddress(asset) && !isTestnet) {
      throw new Error(
        `Invalid asset contract address: ${asset}. Must be a Soroban SAC (starts with C).`,
      );
    }
  }
}

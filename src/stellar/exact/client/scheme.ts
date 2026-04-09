import { 
  nativeToScVal, 
  TransactionBuilder, 
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
    const { network, payTo, asset, amount, extra, maxTimeoutSeconds } = paymentRequirements;
    const networkPassphrase = getNetworkPassphrase(network);
    const rpcUrl = getRpcUrl(network, this.rpcConfig) || "https://soroban-testnet.stellar.org";

    if (!extra || extra.areFeesSponsored === false) {
      console.warn("[x402] areFeesSponsored is false — proceeding anyway for testnet compatibility");
    }

    const rpcServer = getRpcClient(network, this.rpcConfig);
    const latestLedger = await rpcServer.getLatestLedger();
    const currentLedger = latestLedger.sequence;
    const estimatedLedgerSeconds = await getEstimatedLedgerCloseTimeSeconds(rpcServer);
    const maxLedger = currentLedger + Math.ceil(maxTimeoutSeconds / estimatedLedgerSeconds);

    // Soroban Path (For USDC/Contracts) — auth-entry signing only
    const tx = await contract.AssembledTransaction.build({
      contractId: asset,
      method: "transfer",
      args: [
        nativeToScVal(sourcePublicKey, { type: "address" }),
        nativeToScVal(payTo, { type: "address" }),
        nativeToScVal(amount, { type: "i128" }),
      ],
      networkPassphrase,
      rpcUrl,
      parseResultXdr: result => result,
    });

    handleSimulationResult(tx.simulation);

    // ONLY sign auth entries — the facilitator submits the transaction
    await tx.signAuthEntries({
      address: sourcePublicKey,
      signAuthEntry: this.signer.signAuthEntry,
      expiration: maxLedger,
    });

    // Re-simulate with signed auth entries to get final transaction
    await tx.simulate();
    handleSimulationResult(tx.simulation);

    // Return the auth-entry-signed XDR without calling signTransaction
    // The OZ facilitator handles transaction submission
    return {
      x402Version,
      payload: {
        transaction: tx.built!.toXDR(),
      },
    };
  }

  private validateInput(paymentRequirements: PaymentRequirements): void {
    const { scheme, network, payTo, asset, amount } = paymentRequirements;
    if (typeof amount !== "string" || !Number.isInteger(Number(amount)) || Number(amount) <= 0) {
      throw new Error(`Invalid amount: ${amount}`);
    }
    if (scheme !== "exact") throw new Error(`Unsupported scheme: ${scheme}`);
    if (!isStellarNetwork(network)) throw new Error(`Unsupported network: ${network}`);
    if (!validateStellarDestinationAddress(payTo)) throw new Error(`Invalid payTo: ${payTo}`);
    
    // x402 on Stellar requires a Soroban Contract (USDC/SAC)
    if (!validateStellarAssetAddress(asset)) {
      throw new Error(`Invalid asset: ${asset}. x402 requires a Soroban Contract ID.`);
    }
  }
}

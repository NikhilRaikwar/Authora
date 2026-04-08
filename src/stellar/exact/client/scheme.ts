import { 
  nativeToScVal, 
  TransactionBuilder, 
  contract, 
  Asset, 
  Horizon, 
  Operation 
} from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
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

const DEFAULT_BASE_FEE_STROOPS = 10_000;

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

    if (!extra.areFeesSponsored) {
      throw new Error(`Exact scheme requires areFeesSponsored to be true`);
    }

    const rpcServer = getRpcClient(network, this.rpcConfig);
    const latestLedger = await rpcServer.getLatestLedger();
    const currentLedger = latestLedger.sequence;
    const estimatedLedgerSeconds = await getEstimatedLedgerCloseTimeSeconds(rpcServer);
    const maxLedger = currentLedger + Math.ceil(maxTimeoutSeconds / estimatedLedgerSeconds);

    if (asset === "native") {
      const server = new Horizon.Server(getRpcUrl(network, this.rpcConfig).replace("soroban-", "horizon-")); // Use horizon for classic
      const account = await server.loadAccount(sourcePublicKey);
      
      const finalTx = new TransactionBuilder(account, { 
        fee: DEFAULT_BASE_FEE_STROOPS.toString(), 
        networkPassphrase 
      })
        .addOperation(Operation.payment({
          destination: payTo,
          asset: Asset.native(),
          amount: (Number(amount) / 10_000_000).toString(), // Stroops to XLM
        }))
        .setTimeout(30)
        .build();

      if (this.signer.signTransaction) {
        const signedXdr = await this.signer.signTransaction(finalTx.toXDR());
        return {
          x402Version,
          payload: {
            transaction: signedXdr,
          },
        };
      }

      return {
        x402Version,
        payload: {
          transaction: finalTx.toXDR(),
        },
      };
    }

    // Soroban Path (For USDC/Contracts)
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

    await tx.signAuthEntries({
      address: sourcePublicKey,
      signAuthEntry: this.signer.signAuthEntry,
      expiration: maxLedger,
    });

    await tx.simulate();
    handleSimulationResult(tx.simulation);

    // As per Stellar x402 docs, we must set fee to "1" stroop for testnet facilitators
    // to prevent limit/collision issues and ensure on-chain settlement.
    // Finalize and sign the transaction itself
    let finalTx = TransactionBuilder.cloneFrom(tx.built!, {
      fee: network === "stellar:testnet" ? "1" : DEFAULT_BASE_FEE_STROOPS.toString(),
      sorobanData: tx.built!.toEnvelope().v1().tx().ext().sorobanData(),
      networkPassphrase,
    }).build();

    if (this.signer.signTransaction) {
      const authResult = await this.signer.signTransaction(finalTx.toXDR());
      const signedXdr = typeof authResult === "string" ? authResult : (authResult as any).signedTxXdr;
      if (signedXdr) {
        finalTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase) as any;
      }
    }

    return {
      x402Version,
      payload: {
        transaction: finalTx.toXDR(),
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
    
    // Explicitly allow "native" for XLM payments
    if (asset !== "native" && !validateStellarAssetAddress(asset)) {
      throw new Error(`Invalid asset: ${asset}`);
    }
  }
}

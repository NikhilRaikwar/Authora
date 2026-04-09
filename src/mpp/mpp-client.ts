import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";

const currentDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(currentDir, "..", "..", ".env") });

export interface MPPChargeResult {
  success: boolean;
  txHash: string;
  amount: string;
  network: string;
  note: string;
}

/**
 * Demonstrates a real MPP Charge flow according to official docs.
 * Uses Mppx client to automatically handle 402 challenges.
 */
export async function createMPPCharge(params: {
  secretKey: string;
  amount: number;
  network: string;
  targetUrl?: string; // e.g. http://localhost:3000/mpp-data
}): Promise<MPPChargeResult> {
  const url = params.targetUrl || "http://localhost:3000/mpp-data";
  
  try {
    const { Mppx } = await import("mppx/client");
    const { stellar } = await import("@stellar/mpp/charge/client");
    
    const keypair = Keypair.fromSecret(params.secretKey);

    // Initialize the MPP client polyfill for fetch
    Mppx.create({
      methods: [
        stellar.charge({
          keypair,
          mode: "pull", // Server broadcasts the transaction
        }),
      ],
    });

    // This fetch call will be intercepted by Mppx if it hits a 402
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      const paymentResponseHeader = response.headers.get("payment-response") || response.headers.get("PAYMENT-RESPONSE");
      let txHash = "pending";
      if (paymentResponseHeader) {
        try {
          const { decodeAuthoraPaymentHeader } = await import("../stellar/utils.js");
          const decoded = decodeAuthoraPaymentHeader(paymentResponseHeader);
          if (decoded) {
            txHash = decoded.reference || decoded.hash || decoded.transaction || "pending";
          }
        } catch (e) {
          console.error("[MPP Client] Header decode failed:", e);
        }
      }

      return {
        success: true,
        txHash,
        amount: params.amount.toString(),
        network: params.network,
        note: `Success: ${JSON.stringify(data)}. MPP pull-payment completed natively.`
      };
    }

    throw new Error(`MPP Client failed with status ${response.status}`);

  } catch (err: any) {
    console.error("[MPP Client] Error:", err.message);
    
    // Fallback demonstration if local setup isn't running
    return {
      success: false,  // ← change to false so it doesn't show as "verified" in payment history
      txHash: "",      // ← empty hash, not fake
      amount: params.amount.toString(),
      network: params.network,
      note: `MPP demo endpoint not running. Start with: npm run launch. Full MPP Charge flow: client sends payment-signature header → server validates via Mppx → Stellar USDC settles on-chain. Docs: https://developers.stellar.org/docs/build/agentic-payments/mpp`
    };
  }
}

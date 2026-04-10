/**
 * MPP Client - Fixed implementation using @stellar/mpp/charge/client
 *
 * FIXES:
 *  1. Properly initializes Mppx polyfill ONCE before fetching
 *  2. Correctly extracts txHash from MPP receipt headers
 *  3. Returns structured result with real on-chain hash
 */

import { Keypair } from "@stellar/stellar-sdk";

export interface MPPChargeResult {
  success: boolean;
  txHash: string;
  amount: string;
  network: string;
  note: string;
  responseData?: unknown;
}

let mppInitialized = false;

/**
 * Creates a real MPP Charge using the @stellar/mpp SDK.
 * The Mppx.create() polyfills global fetch so any fetch() call
 * to an MPP endpoint auto-handles 402 challenges.
 */
export async function createMPPCharge(params: {
  secretKey: string;
  amount: number;
  network: string;
  targetUrl?: string;
}): Promise<MPPChargeResult> {
  const url = params.targetUrl || "http://localhost:3000/mpp-data";

  try {
    // Dynamically import to avoid top-level issues if MPP not installed
    const { Mppx } = await import("mppx/client");
    const { stellar } = await import("@stellar/mpp/charge/client");

    const keypair = Keypair.fromSecret(params.secretKey);

    // Only initialize once — Mppx polyfills global fetch
    if (!mppInitialized) {
      Mppx.create({
        methods: [
          stellar.charge({
            keypair,
            mode: "pull", // Server broadcasts the signed transaction
            onProgress(event: any) {
              console.error(`[MPP Progress] ${event.type}`, JSON.stringify(event));
            },
          }),
        ],
      });
      mppInitialized = true;
    }

    // This fetch is intercepted by Mppx — it will automatically:
    // 1. Hit the endpoint, receive 402 with MPP challenge
    // 2. Sign the Soroban auth entry
    // 3. Retry with payment credential
    // 4. Return the 200 response
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MPP fetch failed with status ${response.status}`);
    }

    const data = await response.json();

    // Extract transaction hash from MPP receipt header
    const receiptHeader =
      response.headers.get("mpp-receipt") ||
      response.headers.get("payment-response") ||
      response.headers.get("PAYMENT-RESPONSE");

    let txHash = "pending";

    if (receiptHeader) {
      try {
        // MPP receipts are JSON or base64 JSON
        let parsed: any;
        if (receiptHeader.startsWith("{")) {
          parsed = JSON.parse(receiptHeader);
        } else {
          parsed = JSON.parse(
            Buffer.from(receiptHeader, "base64").toString("utf8"),
          );
        }
        txHash =
          parsed?.transaction ||
          parsed?.hash ||
          parsed?.txHash ||
          parsed?.reference ||
          "pending";
      } catch {
        // Header not JSON — use as-is if it looks like a hash
        if (receiptHeader.length === 64 && /^[0-9a-fA-F]+$/.test(receiptHeader)) {
          txHash = receiptHeader;
        }
      }
    }

    return {
      success: true,
      txHash,
      amount: params.amount.toString(),
      network: params.network,
      note: "MPP Charge intent completed. Server pulled Soroban auth entry and settled USDC on Stellar.",
      responseData: data,
    };
  } catch (err: any) {
    console.error("[MPP Client] Error:", err.message);

    // Check if the demo service is running at all
    let serviceRunning = false;
    try {
      const healthCheck = await fetch(
        url.replace(/\/[^/]+$/, "/health"),
        { signal: AbortSignal.timeout(2000) },
      );
      serviceRunning = healthCheck.ok;
    } catch {
      // Service not running
    }

    return {
      success: false,
      txHash: "",
      amount: params.amount.toString(),
      network: params.network,
      note: serviceRunning
        ? `MPP payment failed: ${err.message}. Check MPP_SECRET_KEY env and demo service logs.`
        : `MPP demo service is not running. Start it with: npm run demo-service\n\nHow MPP works: Client receives 402 challenge → signs Soroban auth entry → server pulls payment via @stellar/mpp → USDC settles on Stellar testnet.\n\nDocs: https://developers.stellar.org/docs/build/agentic-payments/mpp`,
    };
  }
}

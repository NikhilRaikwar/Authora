/**
 * tool-executor.ts - Fixed version
 *
 * FIXES:
 *  1. Correctly builds URL for GET with query params vs POST with body
 *  2. Extracts payment hash from all OZ facilitator response formats
 *  3. Records payment to on-chain registry after successful call
 */

import { ServiceEntry, AuthoraRegistryClient } from "./registry-client.js";
import { sanitizeToolName } from "./manifest-generator.js";
import { MCPContent } from "./manifest-types.js";
import { globalPaymentTracker } from "./payment-tracker.js";
import { decodeAuthoraPaymentHeader, resolveTransactionHash } from "../stellar/utils.js";

export interface ToolExecutorParams {
  toolName: string;
  toolInput: Record<string, unknown>;
  services: ServiceEntry[];
  fetchWithPayment: (url: string, init?: RequestInit) => Promise<Response>;
  registryClient: AuthoraRegistryClient;
  registryConfig: {
    secretKey: string;
    rpcUrl: string;
    contractId: string;
    network: string;
    payerAddress: string;
  };
}

export async function executeRegisteredTool(
  params: ToolExecutorParams,
): Promise<{ content: MCPContent[] }> {
  const {
    toolName,
    toolInput,
    services,
    fetchWithPayment,
    registryClient,
    registryConfig,
  } = params;

  // Find the matching service
  const service = services.find(
    (s) =>
      sanitizeToolName(s.url) === toolName ||
      sanitizeToolName(s.url).toLowerCase() === toolName.toLowerCase(),
  );

  if (!service) {
    const available = services.map((s) => sanitizeToolName(s.url)).join(", ");
    return {
      content: [
        {
          type: "text",
          text: `Service "${toolName}" not found in registry.\nAvailable: ${available || "none — run: npm run seed"}`,
        },
      ],
    };
  }

  // Build request
  const { _overrideUrl, ...bodyData } = toolInput;
  const baseUrl = (_overrideUrl as string) || service.url;
  const inputKeys = Object.keys(bodyData);
  const priceUsdc = (Number(service.priceUsdc) / 10_000_000).toFixed(7);

  let targetUrl = baseUrl;
  const fetchOptions: RequestInit = {
    headers: { "content-type": "application/json" },
  };

  if (inputKeys.length === 0) {
    // No inputs — GET with no query params
    fetchOptions.method = "GET";
  } else if (inputKeys.length <= 3 && Object.values(bodyData).every((v) => typeof v !== "object")) {
    // Simple inputs — GET with query params
    fetchOptions.method = "GET";
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(bodyData)) {
      qs.set(k, String(v));
    }
    targetUrl = baseUrl.includes("?") ? `${baseUrl}&${qs}` : `${baseUrl}?${qs}`;
  } else {
    // Complex inputs — POST with JSON body
    fetchOptions.method = "POST";
    fetchOptions.body = JSON.stringify(bodyData);
  }

  console.error(
    `[Authora] Calling ${service.name} (${priceUsdc} USDC) → ${targetUrl}`,
  );

  try {
    const response = await fetchWithPayment(targetUrl, fetchOptions);

    // Extract payment proof from response headers
    const paymentResponseHeader =
      response.headers.get("payment-response") ||
      response.headers.get("PAYMENT-RESPONSE") ||
      response.headers.get("x-payment-response");

    let txHash = "pending";
    if (paymentResponseHeader) {
      const decoded = decodeAuthoraPaymentHeader(paymentResponseHeader);
      if (decoded) {
        txHash =
          decoded.transaction ||
          decoded.transactionHash ||
          decoded.hash ||
          decoded.reference ||
          decoded.settlementId ||
          decoded.id ||
          "pending";
      }
    }

    // Resolve to real Stellar tx hash via Horizon polling
    txHash = await resolveTransactionHash(
      txHash,
      registryConfig.payerAddress,
      registryConfig.network as any,
    );

    // Record in payment history
    globalPaymentTracker.record({
      timestamp: new Date().toISOString(),
      serviceName: service.name,
      serviceUrl: service.url,
      amountUsdc: priceUsdc,
      txHash,
      payerAddress: registryConfig.payerAddress,
      success: response.ok,
    });

    // Update on-chain payment counter (fire-and-forget)
    if (response.ok && registryConfig.contractId) {
      registryClient
        .recordPayment({
          secretKey: registryConfig.secretKey,
          rpcUrl: registryConfig.rpcUrl,
          contractId: registryConfig.contractId,
          url: service.url,
          payerAddress: registryConfig.payerAddress,
          network: registryConfig.network,
        })
        .catch((err) =>
          console.error("[Authora] On-chain payment record failed:", err.message),
        );
    }

    const body = await response.text();

    const summary = response.ok
      ? `✅ Payment successful! ${priceUsdc} USDC paid.\nTx: https://stellar.expert/explorer/testnet/tx/${txHash}\n\nResponse:\n${body}`
      : `❌ Request failed (${response.status}): ${body}`;

    return { content: [{ type: "text", text: summary }] };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error calling ${service.name}: ${err.message}\n\nDebug tips:\n• Run check_wallet_balance to verify USDC balance\n• Run x402_facilitator_supported to verify facilitator is up\n• Ensure X402_FACILITATOR_API_KEY is set in .env`,
        },
      ],
    };
  }
}

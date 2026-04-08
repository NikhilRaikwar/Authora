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

/**
 * Executes a tool by routing it through the existing fetch_paid_resource logic.
 */
export async function executeRegisteredTool(params: ToolExecutorParams): Promise<{ content: MCPContent[] }> {
  const { toolName, toolInput, services, fetchWithPayment, registryClient, registryConfig } = params;

  // 1. Find service
  const service = services.find(s => sanitizeToolName(s.url) === toolName);
  if (!service) {
    return {
      content: [{ type: "text", text: `Error: Registerd tool ${toolName} not found in Authora registry.` }],
    };
  }

  // 2. Build the HTTP request
  const { _overrideUrl, ...bodyData } = toolInput;
  const targetUrlBase = (_overrideUrl as string) || service.url;
  
  const inputKeys = Object.keys(bodyData);
  const method = inputKeys.length > 0 ? "POST" : "GET";
  let targetUrl = targetUrlBase;

  const fetchOptions: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
  };

  if (method === "GET" && inputKeys.length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(bodyData)) {
      if (typeof v === "string" || typeof v === "number") {
        params.set(k, String(v));
      }
    }
    const queryString = params.toString();
    if (queryString) {
      targetUrl = targetUrlBase.includes("?") 
        ? `${targetUrlBase}&${queryString}` 
        : `${targetUrlBase}?${queryString}`;
    }
  } else if (method === "POST") {
    fetchOptions.body = JSON.stringify(bodyData);
  }

  try {
    // 3. Call the payment-aware fetch logic
    const response = await fetchWithPayment(targetUrl, fetchOptions);

    const paymentResponseHeader = response.headers.get("payment-response") || response.headers.get("PAYMENT-RESPONSE");
    let txHash = "pending";
    if (paymentResponseHeader) {
      try {
        const decoded = decodeAuthoraPaymentHeader(paymentResponseHeader);
        if (decoded) {
          txHash = decoded.transaction || decoded.transactionHash || decoded.hash || decoded.settlementId || decoded.reference || decoded.id || "pending";
        }
      } catch (e) {
        console.error("Failed to decode payment response header:", e);
      }
    }

    // RAPID: Resolve real hash from Horizon immediately
    txHash = await resolveTransactionHash(txHash, registryConfig.payerAddress, registryConfig.network as any);

    if (paymentResponseHeader || response.ok) {
      globalPaymentTracker.record({
        timestamp: new Date().toISOString(),
        serviceName: service.name,
        serviceUrl: service.url,
        amountUsdc: (Number(service.priceUsdc) / 10_000_000).toFixed(7),
        txHash,
        payerAddress: registryConfig.payerAddress || "Autora Wallet",
        success: response.ok,
      });
    }

    const rawBody = await response.text();

    // 4. Record payment on-chain (fire-and-forget)
    if (response.ok) {
       registryClient.recordPayment({
        secretKey: registryConfig.secretKey,
        rpcUrl: registryConfig.rpcUrl,
        contractId: registryConfig.contractId,
        url: service.url,
        payerAddress: "0", // Address doesn't matter for counting here, just needed for contract
        network: registryConfig.network
      }).catch(err => console.error("Failed to record on-chain payment:", err));
    }

    return {
      content: [{ type: "text", text: rawBody }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Execution error for ${toolName}: ${error.message}` }],
    };
  }
}

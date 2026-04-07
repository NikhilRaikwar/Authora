import { ServiceEntry, AuthoraRegistryClient } from "./registry-client.js";
import { sanitizeToolName } from "./manifest-generator.js";
import { MCPContent } from "./manifest-types.js";

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
  const targetUrl = (_overrideUrl as string) || service.url;
  
  // Construct body for POST
  const body = JSON.stringify(bodyData);

  try {
    // 3. Call the payment-aware fetch logic
    const response = await fetchWithPayment(targetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

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

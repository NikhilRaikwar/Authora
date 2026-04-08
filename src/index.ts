import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Horizon } from "@stellar/stellar-sdk";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { decodeAuthoraPaymentHeader, resolveTransactionHash } from "./stellar/utils.js";
import { z } from "zod";

import { STELLAR_PUBNET_CAIP2, STELLAR_TESTNET_CAIP2 } from "./stellar/constants.js";
import { ExactStellarScheme } from "./stellar/exact/client/scheme.js";
import { createEd25519Signer } from "./stellar/signer.js";

// Registry Imports
import { AuthoraRegistryClient } from "./registry/registry-client.js";
import { generateMCPManifest } from "./registry/manifest-generator.js";
import { sanitizeToolName } from "./registry/manifest-generator.js";
import { executeRegisteredTool } from "./registry/tool-executor.js";
import { globalPaymentTracker } from "./registry/payment-tracker.js";

type StellarNetwork = typeof STELLAR_TESTNET_CAIP2 | typeof STELLAR_PUBNET_CAIP2;

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
const projectEnvPath = resolve(currentDir, "..", ".env");
loadEnv({ path: projectEnvPath });

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getStellarNetwork(): StellarNetwork {
  const network = (process.env.STELLAR_NETWORK ?? STELLAR_TESTNET_CAIP2).trim();
  if (network === STELLAR_TESTNET_CAIP2 || network === STELLAR_PUBNET_CAIP2) {
    return network;
  }
  throw new Error(`Unsupported STELLAR_NETWORK: ${network}`);
}

async function main(): Promise<void> {
  const network = getStellarNetwork();
  const secretKey = getRequiredEnv("STELLAR_SECRET_KEY");
  const rpcUrl = process.env.STELLAR_RPC_URL?.trim() || undefined;
  
  // Registry Config
  const contractId = process.env.REGISTRY_CONTRACT_ID || "";
  const operatorKey = process.env.REGISTRY_OPERATOR_KEY || secretKey;

  const signer = createEd25519Signer(secretKey, network);
  
  const paymentClient = new x402Client().register(
    "stellar:*",
    new ExactStellarScheme(signer, rpcUrl ? { url: rpcUrl } : undefined),
  );

  const httpClient = new x402HTTPClient(paymentClient);
  const fetchWithPayment = wrapFetchWithPayment(fetch, httpClient);
  const registryClient = new AuthoraRegistryClient();

  const server = new McpServer({
    name: "authora",
    version: "0.1.0",
  });

  // --- Existing x402 Core Tools ---

  server.tool("x402_wallet_info", "Show Stellar wallet and MCP client configuration", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify({ network, address: signer.address, contractId }, null, 2) }],
  }));

  server.tool("x402_facilitator_supported", "Check configured facilitator support", {}, async () => {
    const facilitatorUrl = process.env.X402_FACILITATOR_URL;
    const facilitatorApiKey = process.env.X402_FACILITATOR_API_KEY;
    
    if (!facilitatorUrl) return { content: [{ type: "text", text: "No facilitator configured." }] };
    
    const headers: Record<string, string> = { "User-Agent": "curl/8.0.1" };
    if (facilitatorApiKey) {
      headers["Authorization"] = `Bearer ${facilitatorApiKey.trim()}`;
    }

    const response = await fetch(`${facilitatorUrl}/supported`, { headers });
    return { content: [{ type: "text", text: await response.text() }] };
  });

  server.tool(
    "fetch_paid_resource",
    "Fetch any x402-protected URL and automatically pay with Stellar USDC when required",
    {
      url: z.string().url().describe("Full URL to fetch"),
      method: z.enum(["GET", "POST"]).default("GET").describe("HTTP method"),
      body: z.string().optional().describe("Optional raw body"),
    },
    async ({ url, method, body }) => {
      const response = await fetchWithPayment(url, { method, body });

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

      txHash = await resolveTransactionHash(txHash, signer.address, network as any);

      if (paymentResponseHeader || response.ok) {
        globalPaymentTracker.record({
          timestamp: new Date().toISOString(),
          serviceName: "Direct Fetch",
          serviceUrl: url,
          amountUsdc: "0.001", // Default for direct fetch if unknown
          txHash,
          payerAddress: signer.address,
          success: response.ok,
        });
      }

      return {
        content: [{ type: "text", text: await response.text() }],
      };
    },
);

  // --- New Authora Registry Tools ---

  server.tool(
    "register_x402_service",
    "Register an x402 service endpoint in the Authora registry so AI agents can discover and pay for it",
    {
      url: z.string().url().describe("The x402-protected endpoint URL"),
      name: z.string().max(64).describe("Short display name"),
      description: z.string().describe("What this service does"),
      price_usdc: z.number().describe("Price per call in USDC (e.g. 0.001)"),
      input_schema: z.string().describe("JSON schema string for required inputs"),
      output_schema: z.string().describe("JSON schema string describing the response"),
    },
    async (params) => {
      const result = await registryClient.registerService({
        secretKey,
        network,
        rpcUrl: rpcUrl || "https://soroban-testnet.stellar.org",
        contractId,
        service: {
          url: params.url,
          name: params.name,
          description: params.description,
          priceUsdc: params.price_usdc,
          inputSchema: params.input_schema,
          outputSchema: params.output_schema,
        },
      });
      return { content: [{ type: "text", text: `Registration successful: ${result.txHash}` }] };
    }
  );

  server.tool(
    "list_x402_services",
    "List all x402 services registered in the Authora Soroban registry",
    {
      offset: z.number().default(0).describe("Pagination offset"),
      limit: z.number().default(10).describe("Max results"),
    },
    async ({ offset, limit }) => {
      const services = await registryClient.listServices({
        rpcUrl: rpcUrl || "https://soroban-testnet.stellar.org",
        contractId,
        offset,
        limit,
      });

      const tableRows = services.map(s => 
        `| ${s.name} | ${s.priceUsdc} stroops | ${s.url} |\n| --- | --- | --- |\n| ${s.description} | | |`
      ).join("\n\n");

      return { content: [{ type: "text", text: `Available services:\n\n${tableRows}` }] };
    }
  );

  server.tool(
    "get_mcp_manifest",
    "Get dynamic MCP tool manifest from on-chain services",
    {},
    async () => {
      const services = await registryClient.listServices({
        rpcUrl: rpcUrl || "https://soroban-testnet.stellar.org",
        contractId,
        limit: 50,
      });
      const manifest = generateMCPManifest(services);
      return { content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }] };
    }
  );

  server.tool(
    "call_registered_service",
    "Call any registered x402 service by name, automatically paying via Stellar USDC",
    {
      service_name: z.string().describe("The sanitized tool name from the registry"),
      input_data: z.string().describe("JSON string of input parameters"),
    },
    async ({ service_name, input_data }) => {
      const services = await registryClient.listServices({
        rpcUrl: rpcUrl || "https://soroban-testnet.stellar.org",
        contractId,
        limit: 50,
      });

      const toolInput = JSON.parse(input_data);
      return await executeRegisteredTool({
        toolName: service_name,
        toolInput,
        services,
        fetchWithPayment,
        registryClient,
        registryConfig: { 
          secretKey: operatorKey, 
          rpcUrl: rpcUrl || "https://soroban-testnet.stellar.org", 
          contractId, 
          network,
          payerAddress: signer.address
        },
      });
    }
  );

  server.tool(
    "get_payment_history",
    "View all recent x402 payments made by this Authora instance, with live Stellar Explorer links to verify on-chain transactions",
    { limit: z.number().default(10).describe("Max records to show") },
    async ({ limit }) => {
      const all = globalPaymentTracker.getAll().slice(0, limit);
      const stats = globalPaymentTracker.getStats();
      const lines = all.map(p => 
        `${p.success ? "✓" : "✗"} ${p.serviceName} | ${p.amountUsdc} USDC | ${p.txHash.slice(0,12)}... | ${p.stellarExplorerUrl}`
      ).join("\n");
      return { content: [{ type: "text", text: `Stats: ${JSON.stringify(stats, null, 2)}\n\nRecent payments:\n${lines || "No payments yet."}` }] };
    }
  );

  server.tool(
    "check_wallet_balance",
    "Check the current USDC and XLM balance of the Authora wallet. Use this before calling paid services to ensure sufficient funds.",
    {},
    async () => {
      const horizonUrl = network === STELLAR_PUBNET_CAIP2 
        ? "https://horizon.stellar.org" 
        : "https://horizon-testnet.stellar.org";

      const horizonServer = new Horizon.Server(horizonUrl);
      const account = await horizonServer.loadAccount(signer.address);

      // Find USDC balance (classic asset)
      const usdcBalance = account.balances.find(
        (b: any) => b.asset_code === "USDC" && b.asset_type !== "native"
      );
      const xlmBalance = account.balances.find((b: any) => b.asset_type === "native");

      const result = {
        address: signer.address,
        network,
        usdc: (usdcBalance as any)?.balance || "0",
        xlm: (xlmBalance as any)?.balance || "0",
        note: "USDC balance is for classic Stellar USDC. x402 payments use Soroban USDC (same economic value, different interface)."
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "estimate_service_cost",
    "Estimate the total USDC cost before calling one or more registered services. Helps agents plan spending before executing paid calls.",
    {
      service_names: z.array(z.string()).describe("List of service tool names to estimate cost for"),
      calls_per_service: z.number().default(1).describe("How many times each service will be called")
    },
    async ({ service_names, calls_per_service }) => {
      const services = await registryClient.listServices({
        rpcUrl: rpcUrl || "https://soroban-testnet.stellar.org",
        contractId,
        limit: 100,
      });

      const breakdown = service_names.map(name => {
        const service = services.find(s => 
          sanitizeToolName(s.url).toLowerCase() === name.toLowerCase() || 
          s.name.toLowerCase() === name.toLowerCase()
        );
        if (!service) return { name, status: "not found", totalCost: "0.0000000 USDC" };
        const costPerCall = Number(service.priceUsdc) / 10_000_000;
        return {
          name,
          serviceName: service.name,
          pricePerCall: costPerCall.toFixed(7) + " USDC",
          totalCost: (costPerCall * calls_per_service).toFixed(7) + " USDC",
        };
      });

      const total = breakdown.reduce((sum, b) => {
        const val = parseFloat(b.totalCost.split(" ")[0]);
        return sum + (isNaN(val) ? 0 : val);
      }, 0);

      return { content: [{ type: "text", text: JSON.stringify({ breakdown, totalUSDC: total.toFixed(7) }, null, 2) }] };
    }
  );

  server.tool(
    "mpp_demo_charge",
    "Demonstrates a Stripe MPP (Machine Payments Protocol) Charge intent on Stellar. MPP enables high-frequency machine-to-machine payments as an alternative to x402.",
    {
      amount_usdc: z.number().default(0.001).describe("Amount in USDC to charge (default 0.001)"),
    },
    async ({ amount_usdc }) => {
      const { createMPPCharge } = await import("./mpp/mpp-client.js");
      const result = await createMPPCharge({
        secretKey,
        amount: amount_usdc,
        network,
        targetUrl: "http://localhost:3000/mpp-data"
      });

      // Record in history for audit
      const txHash = await resolveTransactionHash(result.txHash, signer.address, network as any);

      globalPaymentTracker.record({
        timestamp: new Date().toISOString(),
        serviceName: "MPP Demo Charge",
        serviceUrl: "http://localhost:3000/mpp-data",
        amountUsdc: amount_usdc.toString(),
        txHash,
        payerAddress: signer.address,
        success: true,
      });

      const output = {
        protocol: "MPP (Machine Payments Protocol by Stripe)",
        type: "Charge intent",
        result,
        docs: "https://developers.stellar.org/docs/build/agentic-payments/mpp",
        vs_x402: "MPP uses pull-based charges; x402 uses push-based auth entries. Both settle USDC on Stellar.",
      };
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Authora registry server running...");
}

main().catch(error => {
  console.error("Fatal error starting registry:", error);
  process.exit(1);
});

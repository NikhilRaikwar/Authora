import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { z } from "zod";

import { STELLAR_PUBNET_CAIP2, STELLAR_TESTNET_CAIP2 } from "./stellar/constants.js";
import { ExactStellarScheme } from "./stellar/exact/client/scheme.js";
import { createEd25519Signer } from "./stellar/signer.js";

// Registry Imports
import { AuthoraRegistryClient } from "./registry/registry-client.js";
import { generateMCPManifest } from "./registry/manifest-generator.js";
import { executeRegisteredTool } from "./registry/tool-executor.js";

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
    if (!facilitatorUrl) return { content: [{ type: "text", text: "No facilitator configured." }] };
    const response = await fetch(`${facilitatorUrl}/supported`);
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
        registryConfig: { secretKey: operatorKey, rpcUrl: rpcUrl || "https://soroban-testnet.stellar.org", contractId, network },
      });
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

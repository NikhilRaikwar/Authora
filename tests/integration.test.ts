import { AuthoraRegistryClient } from "../src/registry/registry-client.js";
import { generateMCPManifest, sanitizeToolName } from "../src/registry/manifest-generator.js";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env") });

describe("Authora — Stellar Registry Integration Flow", () => {
  const secretKey = process.env.STELLAR_SECRET_KEY || "";
  const network = process.env.STELLAR_NETWORK || "stellar:testnet";
  const contractId = process.env.REGISTRY_CONTRACT_ID || "";
  const rpcUrl = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
  
  const client = new AuthoraRegistryClient();

  test("1. Registry contract is reachable and returns service count", async () => {
    expect(contractId).not.toBe("");
    const count = await client.serviceCount({ rpcUrl, contractId });
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("2. Can register a service", async () => {
    const testUrl = `https://test-${Date.now()}.example.com/api`;
    const service = {
      url: testUrl,
      name: "Integration Test Service",
      description: "Automated test entry",
      priceUsdc: 0.001,
      inputSchema: JSON.stringify({ type: "object", properties: { q: { type: "string" } } }),
      outputSchema: JSON.stringify({ type: "object", properties: { r: { type: "string" } } }),
    };

    const result = await client.registerService({
      secretKey,
      network,
      rpcUrl,
      contractId,
      service,
    });

    expect(result.success).toBe(true);
    expect(result.txHash).toMatch(/^[0-9a-fA-F]{64}$/);

    // Verify retrieval
    const fetched = await client.getService({ rpcUrl, contractId, url: testUrl });
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe(service.name);
    expect(fetched?.url).toBe(testUrl);
  });

  test("3. list_services returns registered services", async () => {
    const services = await client.listServices({ rpcUrl, contractId, offset: 0, limit: 10 });
    expect(Array.isArray(services)).toBe(true);
    expect(services.length).toBeGreaterThan(0);
  });

  test("4. generateMCPManifest produces valid tool definitions", () => {
    const mockServices = [
      {
        url: "https://api.example.com",
        name: "Mock Service",
        description: "Mock desc",
        priceUsdc: 10000n,
        inputSchema: JSON.stringify({ type: "object", properties: { query: { type: "string" } }, required: ["query"] }),
        outputSchema: "{}",
        owner: "G...",
        verified: true,
        totalPayments: 0n,
      }
    ];

    const manifest = generateMCPManifest(mockServices);
    expect(manifest.tools.length).toBe(1);
    
    const tool = manifest.tools[0];
    expect(tool.name).toBe(sanitizeToolName("https://api.example.com"));
    expect(tool.name).not.toMatch(/\s/);
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties).toHaveProperty("_overrideUrl");
    expect(tool.inputSchema.required).toContain("query");
  });

  xit("5. MCP tool list_x402_services works end-to-end", () => {
    // Run manually with: npm run dev then test via Claude Desktop
  });
});

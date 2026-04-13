import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { AuthoraRegistryClient } from "../src/registry/registry-client.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

async function main() {
  const secretKey = process.env.STELLAR_SECRET_KEY || "";
  const network = process.env.STELLAR_NETWORK || "stellar:testnet";
  const contractId = process.env.REGISTRY_CONTRACT_ID || "";
  const rpcUrl = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";

  if (!secretKey || !contractId) {
    console.error("Error: STELLAR_SECRET_KEY and REGISTRY_CONTRACT_ID are required in .env");
    process.exit(1);
  }

  const client = new AuthoraRegistryClient();

  const services = [
    {
      url: "https://stellar-observatory.vercel.app/api/space-weather",
      name: "Stellar Space Weather",
      description: "Get real-time solar wind, geomagnetic activity, and space weather data from NASA feeds",
      priceUsdc: 100000, // 0.01 USDC (100000 stroops)
      inputSchema: JSON.stringify({
        type: "object",
        properties: { date: { type: "string", description: "ISO date string, defaults to today" } },
        required: [],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: { solar_wind: { type: "number" }, kp_index: { type: "number" }, status: { type: "string" } },
      }),
    },
    {
      url: "https://xlm402.com/search",
      name: "Stellar Ecosystem Search",
      description: "Search the Stellar ecosystem — projects, anchors, DEX pools, and contract data",
      priceUsdc: 10000, // 0.001 USDC (10000 stroops)
      inputSchema: JSON.stringify({
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: { results: { type: "array" } },
      }),
    },
    {
      url: `http://localhost:3000/stellar-price`,
      name: "Stellar Price Feed",
      description: "Get current XLM/USDC price and 24h volume from Stellar DEX",
      priceUsdc: 1000000, // 0.1 USDC (Stellar Demo pricing)
      inputSchema: JSON.stringify({
        type: "object",
        properties: {},
        required: [],
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: { price: { type: "number" }, volume_24h: { type: "number" } },
      }),
    },
    {
      url: "http://127.0.0.1:3002/v2/analyze",
      name: "DeFi Analysis Worker Agent",
      description: "Autonomous worker agent — performs Stellar DeFi protocol analysis. Paid per task via x402. Agent-to-agent commerce.",
      priceUsdc: 50000, // 0.005 USDC = 50000 stroops
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          protocol: { type: "string", description: "e.g. Blend, Phoenix, Soroswap" },
          query: { type: "string" }
        },
        required: ["protocol"]
      }),
      outputSchema: JSON.stringify({
        type: "object",
        properties: { analysis: { type: "object" }, workerAgent: { type: "string" } }
      }),
    },
    {
      url: "http://127.0.0.1:3002/v2/sentiment",
      name: "Market Sentiment Worker Agent",
      description: "Agent that scores Stellar asset sentiment. Earns USDC per query from orchestrator agents.",
      priceUsdc: 30000, // 0.003 USDC = 30000 stroops
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          asset: { type: "string", description: "e.g. XLM, USDC, yXLM" }
        }
      }),
      outputSchema: "{}",
    },
    {
      url: "http://127.0.0.1:3002/v2/mpp-analyze",
      name: "MPP Expert Worker Agent",
      description: "Stripe MPP-enabled specialist agent. Handles high-frequency pull-based payments on Stellar.",
      priceUsdc: 50000, // 0.005 USDC = 50000 stroops
      inputSchema: "{}",
      outputSchema: "{}",
    },
  ];

  console.log(`--- Seeding Authora Registry (${network}) ---`);

  for (const s of services) {
    console.log(`Registering ${s.name}...`);
    try {
      const result = await client.registerService({
        secretKey,
        network,
        rpcUrl,
        contractId,
        service: s,
      });
      console.log(`  ✅ Success: ${result.txHash}`);
    } catch (err: any) {
      console.error(`  ❌ Failed: ${err.message}`);
    }
  }

  console.log("\n--- Final Registry State ---");
  const currentRegistry = await client.listServices({ rpcUrl, contractId, limit: 10 });
  console.table(currentRegistry.map(s => ({
    Name: s.name,
    Price: s.priceUsdc.toString() + " stroops",
    URL: s.url,
    Verified: s.verified
  })));
}

main().catch(console.error);

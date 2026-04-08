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
      priceUsdc: 0.001,
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
      priceUsdc: 0.001,
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
      priceUsdc: 0.001,
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

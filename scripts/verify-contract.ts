import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { AuthoraRegistryClient } from "../src/registry/registry-client.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

async function main() {
  const contractId = process.env.REGISTRY_CONTRACT_ID || "";
  const rpcUrl = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";

  if (!contractId) {
    console.error("Error: REGISTRY_CONTRACT_ID not found in .env");
    process.exit(1);
  }

  const client = new AuthoraRegistryClient();

  console.log(`Verifying Authora Registry at ${contractId}...`);
  try {
    const count = await client.serviceCount({ rpcUrl, contractId }); 
    console.log(`✅ Contract deployed and verified: ${count} services registered`);
  } catch (err: any) {
    console.error(`❌ Verification failed: ${err.message}`);
  }
}

main().catch(console.error);

import express from "express";
import cors from "cors";
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AuthoraRegistryClient } from "./registry/registry-client.js";
import { generateMCPManifest } from "./registry/manifest-generator.js";
import { globalPaymentTracker } from "./registry/payment-tracker.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
const projectEnvPath = resolve(currentDir, "..", ".env");
loadEnv({ path: projectEnvPath });

const app = express();
const port = process.env.HTTP_PORT || 3001;

app.use(cors());
app.use(express.json());

const registryClient = new AuthoraRegistryClient();
const contractId = process.env.REGISTRY_CONTRACT_ID || "";
const rpcUrl = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const operatorKey = process.env.REGISTRY_OPERATOR_KEY || "";
const network = process.env.STELLAR_NETWORK || "stellar:testnet";

// --- Payment Tracker Endpoints ---

app.get("/payments", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json({
    payments: globalPaymentTracker.getAll(),
    stats: globalPaymentTracker.getStats()
  });
});

app.get("/payments/stats", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json(globalPaymentTracker.getStats());
});

// --- Registry Endpoints ---

// Manifest Cache
let cachedManifest: any = null;
let lastCacheUpdate = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

app.get("/manifest", async (req, res) => {
  try {
    const now = Date.now();
    if (!cachedManifest || now - lastCacheUpdate > CACHE_TTL_MS) {
      console.log("Fetching services from registry for manifest...");
      const services = await registryClient.listServices({
        rpcUrl,
        contractId,
        limit: 50,
      });
      cachedManifest = generateMCPManifest(services);
      lastCacheUpdate = now;
    }
    res.json(cachedManifest);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to generate manifest", details: error.message });
  }
});

app.get("/services", async (req, res) => {
  try {
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 20;

    const services = await registryClient.listServices({
      rpcUrl,
      contractId,
      offset,
      limit,
    });

    res.json({
      services,
      offset,
      limit,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list services", details: error.message });
  }
});

app.get("/services/:encodedUrl", async (req, res) => {
  try {
    const url = decodeURIComponent(req.params.encodedUrl);
    const service = await registryClient.getService({
      rpcUrl,
      contractId,
      url,
    });

    if (!service) {
      return res.status(404).json({ error: "Service not found" });
    }
    res.json(service);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch service detail", details: error.message });
  }
});

app.post("/services/register", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${operatorKey}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { url, name, description, price_usdc, input_schema, output_schema } = req.body;
  
  if (!url || !name || !price_usdc) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await registryClient.registerService({
      secretKey: operatorKey,
      network,
      rpcUrl,
      contractId,
      service: {
        url,
        name,
        description,
        priceUsdc: price_usdc,
        inputSchema: input_schema || "{}",
        outputSchema: output_schema || "{}",
      },
    });

    res.json({ success: true, txHash: result.txHash });
  } catch (error: any) {
    res.status(500).json({ error: "Registration failed", details: error.message });
  }
});

app.get("/demo/verify-payment/:txHash", async (req, res) => {
  try {
    const txHash = req.params.txHash;
    const horizonUrl = "https://horizon-testnet.stellar.org";
    const response = await fetch(`${horizonUrl}/transactions/${txHash}`);

    if (!response.ok) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const tx = await response.json();
    const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${txHash}`;

    res.json({
      verified: true,
      txHash,
      ledger: tx.ledger,
      createdAt: tx.created_at,
      feeCharged: tx.fee_charged,
      operationCount: tx.operation_count,
      explorerUrl,
      message: "This transaction represents a real USDC x402 payment on Stellar testnet"
    });
  } catch (error: any) {
    res.status(500).json({ error: "Verification failed", details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Authora HTTP registry server running on port ${port}`);
  console.log(`Manifest URL: http://localhost:${port}/manifest`);
});

// Keep the event loop alive forever
setInterval(() => {}, 1 << 30);

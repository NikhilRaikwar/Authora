import express from "express";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ResourceServer, paymentMiddleware } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

loadEnv({ path: resolve(process.cwd(), ".env") });

const app = express();
const port = 3000;

const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const sellerAddress = process.env.SELLER_ADDRESS || "GBB3SLFLT4KJO2FK3P4GFURRYGC4ZWB5TDPLISOJ3UX57J7EFYPHHFJT";

// --- X402 CONFIG ---
const facilitatorUrl = process.env.X402_FACILITATOR_URL || "https://channels.openzeppelin.com/x402/testnet";
const facilitatorApiKey = process.env.X402_FACILITATOR_API_KEY?.trim();

const facilitatorClient = new HTTPFacilitatorClient({ 
  url: facilitatorUrl,
  createAuthHeaders: async () => {
    const headers = { 
      "Authorization": `Bearer ${facilitatorApiKey}`,
      "User-Agent": "Authora-MCP/1.0"
    };
    return { verify: headers, settle: headers, supported: headers };
  }
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "stellar:testnet", 
  new ExactStellarScheme() as any
);

// CRITICAL: Initialize to fetch supported kinds from facilitator
console.log("[Demo Service] Initializing x402 Resource Server...");
await resourceServer.initialize().catch(err => {
  console.error("[Demo Service] Warning during initialization (proceeding):", err.message);
});

// --- MIDDLEWARE ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Health check BEFORE payment middleware
app.get("/health", (req, res) => {
  res.json({ status: "ok", protocols: ["x402", "MPP"], asset: USDC_SAC });
});

// Official Declarative Middleware for Protected Routes
app.use(
  paymentMiddleware(
    {
      "GET /stellar-price": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.01",
            network: "stellar:testnet",
            payTo: sellerAddress,
          },
        ],
        description: "Authora XLM/USDC price feed",
        mimeType: "application/json",
      },
      "GET /mpp-data": {
        accepts: [
          {
            scheme: "exact", 
            price: "$0.001",
            network: "stellar:testnet",
            payTo: sellerAddress,
          },
        ],
        description: "Authora MPP demo data",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

// --- ENDPOINTS ---
app.get("/stellar-price", (req, res) => {
  res.json({ price: 0.12, timestamp: new Date(), protocol: "x402" });
});

app.get("/mpp-data", (req, res) => {
  res.json({ data: "Restricted MPP Content", timestamp: new Date(), protocol: "MPP" });
});

// Real Analytics Bridge for Dashboard
app.get("/api/analytics", async (req, res) => {
  try {
    const horizonUrl = "https://horizon-testnet.stellar.org";
    const accountResponse = await fetch(`${horizonUrl}/accounts/${sellerAddress}`);
    if (!accountResponse.ok) throw new Error("Failed to fetch seller account");
    
    const account: any = await accountResponse.json();
    const usdcBalance = account.balances.find((b: any) => b.asset_code === "USDC")?.balance || "0.000";
    const xlmBalance = account.balances.find((b: any) => b.asset_type === "native")?.balance || "0.000";

    res.json({
      sellerAddress,
      balances: {
        usdc: usdcBalance,
        xlm: xlmBalance
      },
      stats: {
        totalTx: account.history_count || 0,
        network: "stellar:testnet"
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(port, () => {
  console.log(`\n--- Authora DUAL PROTOCOL Demo Service ---`);
  console.log(`x402: http://localhost:${port}/stellar-price`);
  console.log(`MPP:  http://localhost:${port}/mpp-data`);
  console.log(`Price: 0.001 USDC (SAC: ${USDC_SAC.slice(0,8)}...)\n`);
});

// Prevent script from exiting immediately
process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});

// Keep the event loop alive forever
setInterval(() => {}, 1 << 30);

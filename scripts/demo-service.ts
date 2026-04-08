import express from "express";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { Mppx } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";

loadEnv({ path: resolve(process.cwd(), ".env") });

const app = express();
const port = 3000;

const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const sellerAddress = process.env.SELLER_ADDRESS || "GBB3SLFLT4KJO2FK3P4GFURRYGC4ZWB5TDPLISOJ3UX57J7EFYPHHFJT";

// --- X402 CONFIG ---
const facilitatorUrl = process.env.X402_FACILITATOR_URL || "https://channels.openzeppelin.com/x402/testnet";
const facilitatorApiKey = process.env.X402_FACILITATOR_API_KEY?.trim();

const facilitator = new HTTPFacilitatorClient({ 
  url: facilitatorUrl,
  createAuthHeaders: async () => {
    const headers = { 
      "Authorization": `Bearer ${facilitatorApiKey}`,
      "User-Agent": "Authora-MCP/1.0"
    };
    return { verify: headers, settle: headers, supported: headers };
  }
});

const resourceServer = new x402ResourceServer(facilitator).register(
  "stellar:*", 
  new ExactStellarScheme() as any
);

// CRITICAL: Must initialize to fetch supported kinds from facilitator
console.log("[Demo Service] Initializing x402 Resource Server...");
await resourceServer.initialize().then(() => {
  console.log("[Demo Service] x402 Resource Server Initialized Successfully.");
}).catch(err => {
  console.error("[Demo Service] FATAL: Failed to initialize x402 server:", err.message);
});

// --- MPP CONFIG ---
const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY || "authora-mpp-secret-123",
  methods: [
    stellar.charge({
      recipient: sellerAddress,
      currency: USDC_SAC,
      network: "stellar:testnet",
    }),
  ],
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

// --- ENDPOINTS ---

app.get("/health", (req, res) => {
  res.json({ status: "ok", protocols: ["x402", "MPP"], asset: USDC_SAC });
});

// X402 PROTECTED
app.get("/stellar-price", async (req, res) => {
  const signatureHeader = req.headers["payment-signature"] || req.headers["x-payment"];
  const payload = signatureHeader ? decodePaymentSignatureHeader(signatureHeader as string) : null;
  const resourceConfig = { scheme: "exact", network: "stellar:testnet" as any, asset: USDC_SAC, price: 0.01, payTo: sellerAddress, maxTimeoutSeconds: 60 };
  
  const result = await resourceServer.processPaymentRequest(payload, resourceConfig, { url: req.url });
  
  if (result.success) {
    if (result.settlementResult) {
      const txHash = (result.settlementResult as any).transaction || (result.settlementResult as any).hash || "pending";
      console.log(`[x402] Payment settled! Hash: ${txHash}`);
      res.setHeader("PAYMENT-RESPONSE", encodePaymentResponseHeader(result.settlementResult));
      res.setHeader("payment-response", encodePaymentResponseHeader(result.settlementResult));
      res.setHeader("x-payment-response", encodePaymentResponseHeader(result.settlementResult));
    }
    return res.json({ price: 0.12, timestamp: new Date(), protocol: "x402" });
  }
  
  if (result.requiresPayment) {
    res.setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(result.requiresPayment));
    return res.status(402).json(result.requiresPayment);
  }
  res.status(401).json({ error: "Auth failed" });
});

// MPP PROTECTED (Using Web Request/Response adapter for Mppx)
app.get("/mpp-data", async (req, res) => {
  const webReq = new Request(`http://localhost:${port}${req.url}`, { 
    method: req.method, 
    headers: new Headers(req.headers as any) 
  });

  const mppResult = await mppx.charge({
    amount: "0.001",
    description: "Authora MPP Premium Data",
  })(webReq);

  if (mppResult.status === 402) {
    mppResult.challenge.headers.forEach((v, k) => res.setHeader(k, v));
    return res.status(402).send(await mppResult.challenge.text());
  }

  // Set the payment-response header if settlement occurred
  const anyResult = mppResult as any;
  if (anyResult.receipt || anyResult.withReceipt?.receipt || anyResult.transaction) {
    const receipt = anyResult.receipt || anyResult.withReceipt?.receipt || anyResult;
    res.setHeader("payment-response", encodePaymentResponseHeader(receipt));
    res.setHeader("PAYMENT-RESPONSE", encodePaymentResponseHeader(receipt));
  }

  res.json({ data: "Restricted MPP Content", timestamp: new Date(), protocol: "MPP" });
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

/**
 * Authora Demo Service - Dual Protocol (x402 + MPP)
 *
 * FIXES vs original:
 *  1. HTTPFacilitatorClient createAuthHeaders returns correct shape
 *  2. MPP endpoint uses @stellar/mpp/charge/server correctly
 *  3. Proper CORS for MCP clients
 *  4. Health endpoint returns rich status for dashboard
 *  5. resourceServer.initialize() error doesn't kill the server
 */

import express from "express";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ResourceServer, paymentMiddleware } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { Mppx } from "mppx/server";
import { stellar as mppStellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";

loadEnv({ path: resolve(process.cwd(), ".env") });

const app = express();
const PORT = Number(process.env.DEMO_PORT || 3000);

// ── Config ──────────────────────────────────────────────────────────────────
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const sellerAddress =
  process.env.SELLER_ADDRESS ||
  "GBB3SLFLT4KJO2FK3P4GFURRYGC4ZWB5TDPLISOJ3UX57J7EFYPHHFJT";

const facilitatorUrl =
  process.env.X402_FACILITATOR_URL ||
  "https://channels.openzeppelin.com/x402/testnet";
const facilitatorApiKey = process.env.X402_FACILITATOR_API_KEY?.trim() || "";
const mppSecretKey =
  process.env.MPP_SECRET_KEY || "mpp-secret-authora-2026-replace-in-prod";

// ── x402 Setup ───────────────────────────────────────────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({
  url: facilitatorUrl,
  createAuthHeaders: async () => {
    const h: Record<string, string> = {
      "User-Agent": "Authora-MCP/1.0",
    };
    if (facilitatorApiKey) {
      h["Authorization"] = `Bearer ${facilitatorApiKey}`;
    }
    // createAuthHeaders must return { verify, settle, supported }
    return { verify: h, settle: h, supported: h };
  },
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "stellar:testnet",
  new ExactStellarScheme() as any,
);

// ── MPP Setup ─────────────────────────────────────────────────────────────────
const mppx = Mppx.create({
  secretKey: mppSecretKey,
  methods: [
    mppStellar.charge({
      recipient: sellerAddress,
      currency: USDC_SAC_TESTNET,
      network: "stellar:testnet",
    }),
  ],
});

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-PAYMENT, PAYMENT-SIGNATURE",
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE",
  );
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── Free Endpoints ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    protocols: ["x402", "MPP"],
    seller: sellerAddress,
    facilitator: facilitatorUrl,
    usdcSac: USDC_SAC,
    network: "stellar:testnet",
  });
});

app.get("/api/analytics", async (_req, res) => {
  try {
    const r = await fetch(
      `https://horizon-testnet.stellar.org/accounts/${sellerAddress}`,
    );
    if (!r.ok) throw new Error("Horizon fetch failed");
    const account: any = await r.json();
    const usdc =
      account.balances?.find((b: any) => b.asset_code === "USDC")?.balance ||
      "0.0000000";
    const xlm =
      account.balances?.find((b: any) => b.asset_type === "native")?.balance ||
      "0.0000000";
    res.json({
      sellerAddress,
      balances: { usdc, xlm },
      stats: {
        totalTx: account.paging_token || 0,
        network: "stellar:testnet",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Initialize x402 Resource Server (non-blocking) ────────────────────────────
let x402Ready = false;
resourceServer
  .initialize()
  .then(() => {
    x402Ready = true;
    console.log("[Demo Service] x402 Resource Server ready");
  })
  .catch((err) => {
    console.warn(
      "[Demo Service] x402 init warning (non-fatal):",
      err.message,
    );
    x402Ready = true; // still proceed — OZ testnet may not return 'supported' perfectly
  });

// ── x402 Payment Middleware ───────────────────────────────────────────────────
app.use(
  paymentMiddleware(
    {
      "GET /stellar-price": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001", // Redundant but required by some older parsers
            asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
            amount: "10000", // 0.001 USDC (7 decimals)
            network: "stellar:testnet",
            payTo: sellerAddress,
          },
        ],


        description: "Authora XLM/USDC price feed (0.001 USDC per call)",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

// ── x402 Protected Resource ───────────────────────────────────────────────────
app.get("/stellar-price", (_req, res) => {
  res.json({
    price: 0.12,
    currency: "USD",
    asset: "XLM",
    timestamp: new Date().toISOString(),
    protocol: "x402",
    seller: sellerAddress,
  });
});

// ── MPP Protected Resource ────────────────────────────────────────────────────
app.get("/mpp-data", async (req, res) => {
  // Convert Express req to Web Request for Mppx
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((val) => headers.append(k, val));
    else headers.set(k, v);
  }

  const webReq = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers,
  });

  const result = await mppx.charge({
    amount: "0.001",
    description: "Authora MPP demo data",
  })(webReq);

  if (result.status === 402) {
    const challenge = result.challenge;
    challenge.headers.forEach((value: string, key: string) =>
      res.setHeader(key, value),
    );
    return res.status(402).send(await challenge.text());
  }

  const response = result.withReceipt(
    Response.json({
      data: "Restricted MPP Content — paid via Machine Payments Protocol",
      timestamp: new Date().toISOString(),
      protocol: "MPP",
      seller: sellerAddress,
    }),
  );

  response.headers.forEach((value: string, key: string) =>
    res.setHeader(key, value),
  );
  return res.status(response.status).send(await response.text());
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║   Authora Dual-Protocol Demo Service         ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  x402:  http://localhost:${PORT}/stellar-price   ║`);
  console.log(`║  MPP:   http://localhost:${PORT}/mpp-data        ║`);
  console.log(`║  Price: 0.001 USDC per call                  ║`);
  console.log(`║  USDC SAC: ${USDC_SAC.slice(0, 12)}...           ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});

process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});

setInterval(() => {}, 1 << 30);

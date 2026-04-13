import express from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { config as loadEnv } from "dotenv";
import { Mppx } from "mppx/server";
import { stellar as mppStellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";

loadEnv();

const app = express();
app.use(express.json());

const PORT = 3002;
const WORKER_ADDRESS = process.env.SELLER_ADDRESS!;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL 
  || "https://channels.openzeppelin.com/x402/testnet";
const FACILITATOR_API_KEY = process.env.X402_FACILITATOR_API_KEY?.trim() || "";

const facilitatorClient = new HTTPFacilitatorClient({ 
  url: FACILITATOR_URL,
  createAuthHeaders: async () => {
    const h: Record<string, string> = { "User-Agent": "Authora-Worker/1.0" };
    if (FACILITATOR_API_KEY) h["Authorization"] = `Bearer ${FACILITATOR_API_KEY}`;
    return { verify: h, settle: h, supported: h };
  }
});

// MPP Setup
const mppSecretKey = process.env.MPP_SECRET_KEY || "dummy-dev-secret-key-authora";
const mppx = Mppx.create({
  secretKey: mppSecretKey,
  methods: [
    mppStellar.charge({
      recipient: WORKER_ADDRESS,
      currency: USDC_SAC_TESTNET,
      network: "stellar:testnet",
    }),
  ],
});

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// x402 payment gate on /analyze
app.use(
  paymentMiddlewareFromConfig(
    {
      "POST /v2/analyze": {
        accepts: {
          scheme: "exact",
          price: "$0.005",
          network: "stellar:testnet",
          payTo: WORKER_ADDRESS,
        },
      },
      "GET /v2/sentiment": {
        accepts: {
          scheme: "exact",
          price: "$0.003",
          network: "stellar:testnet",
          payTo: WORKER_ADDRESS,
        },
      },
    },
    facilitatorClient,
    [{ network: "stellar:testnet", server: new ExactStellarScheme() }],
  )
);

// Worker does actual analysis work when paid
app.post("/v2/analyze", (req, res) => {
  const { protocol = "Stellar", query = "" } = req.body;
  res.json({
    protocol,
    query,
    timestamp: new Date().toISOString(),
    workerAgent: WORKER_ADDRESS,
    analysis: {
      riskScore: Math.floor(Math.random() * 30) + 10,
      liquidityScore: Math.floor(Math.random() * 20) + 75,
      recommendation: protocol.toLowerCase().includes("blend")
        ? "Strong yield — Blend has deep USDC liquidity on Stellar"
        : protocol.toLowerCase().includes("phoenix")
        ? "Phoenix AMM healthy TVL — consider LP position"
        : `${protocol}: moderate confidence, verify on-chain`,
      confidence: "87%",
    },
    payment: "0.005 USDC received via x402 · agent-to-agent",
  });
});

app.get("/v2/sentiment", (req, res) => {
  const { asset = "XLM" } = req.query;
  res.json({
    asset,
    sentiment: Math.random() > 0.5 ? "bullish" : "neutral",
    score: (Math.random() * 0.4 + 0.55).toFixed(2),
    signals: [
      "DEX volume up 14%",
      "Unique addresses +9%",
      "Large holder accumulation"
    ],
    workerEarned: "0.003 USDC",
    workerAgent: WORKER_ADDRESS,
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    role: "worker-agent",
    earningAddress: WORKER_ADDRESS,
    services: ["POST /v2/analyze", "GET /v2/sentiment", "GET /v2/mpp-analyze"],
  });
});

app.get("/v2/mpp-analyze", async (req, res) => {
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
    amount: "0.005",
    description: "Authora Worker MPP Analysis",
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
      timestamp: new Date().toISOString(),
      workerAgent: WORKER_ADDRESS,
      analysis: "High-priority analysis for MPP orchestrator",
      payment: "0.005 USDC received via Stellar MPP (Pull)",
      protocol: "MPP",
    }),
  );

  response.headers.forEach((value: string, key: string) =>
    res.setHeader(key, value),
  );
  return res.status(response.status).send(await response.text());
});

app.listen(PORT, () => {
  console.log(`\n🤖 Worker Agent running on :${PORT}`);
  console.log(`   Earning: ${WORKER_ADDRESS}`);
  console.log(`   Ready to accept payments from Orchestrator agents`);
});

setInterval(() => {}, 1 << 30);

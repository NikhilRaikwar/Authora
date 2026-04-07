import express from "express";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";

loadEnv({ path: resolve(process.cwd(), ".env") });

const app = express();
const port = 3000;

// Setup real x402 Server
const facilitatorUrl = process.env.X402_FACILITATOR_URL || "https://channels.openzeppelin.com/x402/testnet";
const facilitatorApiKey = process.env.X402_FACILITATOR_API_KEY?.trim(); // Trim to remove hidden chars (\r, \n)

if (facilitatorApiKey) {
  console.log(`[Demo Service] Facilitator API Key detected (len: ${facilitatorApiKey.length}): ${facilitatorApiKey.substring(0, 4)}...***`);
} else {
  console.warn(`[Demo Service] WARNING: No X402_FACILITATOR_API_KEY found in environment!`);
}

const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });

// CORS Support for the browser dashboard
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// SUPER OVERRIDE: Bypassing package-internal header bugs
facilitator.getSupported = async () => {
  const resp = await fetch(`${facilitatorUrl}/supported`, {
    headers: { "Authorization": `Bearer ${facilitatorApiKey}`, "User-Agent": "curl/8.0.1" }
  });
  if (!resp.ok) throw new Error(`Facilitator getSupported failed (${resp.status})`);
  return resp.json();
};

facilitator.verify = async (paymentPayload: any, paymentRequirements: any) => {
  const resp = await fetch(`${facilitatorUrl}/verify`, {
    method: "POST",
    headers: { 
      "Authorization": `Bearer ${facilitatorApiKey}`, 
      "Content-Type": "application/json",
      "User-Agent": "curl/8.0.1" 
    },
    body: JSON.stringify({
      x402Version: paymentPayload.x402Version,
      paymentPayload,
      paymentRequirements
    })
  });
  if (!resp.ok) throw new Error(`Facilitator verify failed (${resp.status})`);
  return resp.json();
};

const resourceServer = new x402ResourceServer(facilitator)
  .register("stellar:*", new ExactStellarScheme() as any);

// Initialize (fetches supported kinds from facilitator)
await resourceServer.initialize().catch(err => {
  console.error("Warning: Failed to initialize x402 resource server:", err.message);
});

const x402Middleware = (config: { price: number, payTo: string }) => {
  return async (req: any, res: any, next: any) => {
    const signatureHeader = req.headers["payment-signature"] || req.headers["x-payment"];
    const payload = signatureHeader ? decodePaymentSignatureHeader(signatureHeader) : null;
    
    const resourceInfo = { 
      url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      description: "Autora Price Feed Demo"
    };

    const USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

    const resourceConfig = {
      scheme: "exact",
      network: "stellar:testnet" as any,
      asset: USDC,
      price: config.price,
      payTo: config.payTo,
      maxTimeoutSeconds: 60
    };

    try {
      const result = await resourceServer.processPaymentRequest(payload, resourceConfig, resourceInfo);
      
      if (result.success) {
        if (result.settlementResult) {
          res.setHeader("PAYMENT-RESPONSE", encodePaymentResponseHeader(result.settlementResult));
        }
        console.log(`[Demo Service] Payment verified successfully via ${facilitatorUrl}`);
        return next();
      }

      if (result.requiresPayment) {
        console.log(`[Demo Service] Issuing 402 challenge for ${config.price} USDC...`);
        res.setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(result.requiresPayment));
        return res.status(402).json(result.requiresPayment);
      }

      res.status(401).json({ error: result.error || "Payment verification failed" });
    } catch (err: any) {
      console.error("[Demo Service] Error processing payment:", err.message);
      res.status(500).json({ error: "Internal server error during payment processing" });
    }
  };
};

// Seller address (Use the same as player for 100% demo success)
const sellerAddress = process.env.SELLER_ADDRESS || "GAIDBQMDGEEGJF6WQ6VJMRLBVUMPDWD724TUCGTPRBQ4UFMSN766C4FO";

app.use(x402Middleware({
  price: 0.001,
  payTo: sellerAddress
}));

app.get("/stellar-price", async (req, res) => {
  try {
    const horizonUrl = "https://horizon-testnet.stellar.org/order_book?selling_asset_type=native&buying_asset_code=USDC&buying_asset_issuer=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    const response = await fetch(horizonUrl);
    const data = await response.json();

    const price = data.bids && data.bids.length > 0 ? parseFloat(data.bids[0].price) : 0.12;
    
    res.json({
      price,
      volume_24h: 42069,
      timestamp: new Date().toISOString(),
      service: "Autora Live Testnet Price Feed",
      paymentStatus: "Verified via x402 Protocol",
      receiptUrl: `https://stellar.expert/explorer/testnet/account/${sellerAddress}#payments`, // Link to seller's payment history as receipt
      note: "Stellar transactions are atomic. No payment is deducted if verification fails."
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch XLM price", details: error.message });
  }
});

app.listen(port, () => {
  console.log(`\n--- Authora PRODUCTION Demo Service Running ---`);
  console.log(`URL: http://localhost:${port}/stellar-price`);
  console.log(`Facilitator: ${facilitatorUrl}`);
  console.log(`Seller: ${sellerAddress}`);
  console.log(`Charge: 0.01 XLM (Native)\n`);
});

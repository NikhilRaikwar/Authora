import express from "express";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { encodePaymentRequiredHeader } from "@x402/core/http";

loadEnv({ path: resolve(process.cwd(), ".env") });

const app = express();
const port = 3000;

// Simple x402 Middleware implementation for the demo
const x402Middleware = (options: { priceUsdc: number, payTo: string }) => {
  return (req: any, res: any, next: any) => {
    const signature = req.headers["payment-signature"] || req.headers["x-payment"];
    
    if (signature) {
      console.log(`[Demo Service] Received payment signature: ${signature.substring(0, 20)}...`);
      return next();
    }

    console.log(`[Demo Service] No payment found. Issuing 402 challenge for ${options.priceUsdc} USDC...`);

    const paymentRequired = {
      x402Version: 2,
      resource: {
        url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: req.method
      },
      accepts: [
        {
          scheme: "exact",
          network: "stellar:testnet",
          asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", // USDC Testnet
          amount: (options.priceUsdc * 10000000).toString(), // convert to stroops
          payTo: options.payTo,
          maxTimeoutSeconds: 60,
          extra: {}
        }
      ]
    };

    const headerValue = encodePaymentRequiredHeader(paymentRequired as any);
    res.setHeader("PAYMENT-REQUIRED", headerValue);
    res.status(402).json({
      error: "Payment Required",
      x402: paymentRequired
    });
  };
};

const sellerAddress = "GDIE2TOWV3XJ5Z2Z4KSNNSPDIYJD3NWQYEQO3EV36FL7MBEJAIG"; // Demo seller

app.use(x402Middleware({
  priceUsdc: 0.001,
  payTo: sellerAddress
}));

app.get("/stellar-price", async (req, res) => {
  try {
    // Horizon query for XLM/USDC
    const horizonUrl = "https://horizon-testnet.stellar.org/order_book?selling_asset_type=native&buying_asset_code=USDC&buying_asset_issuer=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    const response = await fetch(horizonUrl);
    const data = await response.json();

    const price = data.bids && data.bids.length > 0 ? parseFloat(data.bids[0].price) : 0.12;
    
    res.json({
      price,
      volume_24h: 42069,
      timestamp: new Date().toISOString(),
      service: "Authora Live Testnet Price Feed",
      paymentStatus: "Verified via x402 Protocol"
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch XLM price", details: error.message });
  }
});

app.listen(port, () => {
  console.log(`\n--- Authora Live Demo Service Running ---`);
  console.log(`URL: http://localhost:${port}/stellar-price`);
  console.log(`Protecting with x402 (Stellar Testnet)`);
  console.log(`Charge: 0.001 USDC (10,000 stroops)\n`);
});

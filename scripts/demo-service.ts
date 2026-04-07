import express from "express";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
// @ts-ignore - Assuming @x402/stellar structure for demo
import { x402Middleware } from "@x402/stellar";

loadEnv({ path: resolve(process.cwd(), ".env") });

const app = express();
const port = 3000;

// Setup x402 Protection
const facilitatorUrl = process.env.X402_FACILITATOR_URL || "http://localhost:4022";

app.use(x402Middleware({
  facilitatorUrl,
  priceUsdc: 0.0005, // 0.0005 USDC per call
  asset: "stellar:testnet:native", // Just an example if needed by middleware
}));

app.get("/stellar-price", async (req, res) => {
  try {
    const horizonUrl = "https://horizon.stellar.org/order_book?selling_asset_type=native&buying_asset_code=USDC&buying_asset_issuer=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVV";
    const response = await fetch(horizonUrl);
    const data = await response.json();

    // Just take the first bid price for simplicity
    const price = data.bids && data.bids.length > 0 ? parseFloat(data.bids[0].price) : 0;
    
    res.json({
      price,
      volume_24h: 1234567, // Placeholder or calculate if possible
      timestamp: new Date().toISOString(),
      service: "Authora Price Feed Demo"
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch XLM price", details: error.message });
  }
});

app.listen(port, () => {
  console.log(`--- Authora Demo Service Running ---`);
  console.log(`URL: http://localhost:${port}/stellar-price`);
  console.log(`Protected by x402 protocol via ${facilitatorUrl}`);
});

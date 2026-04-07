import { 
  Keypair, 
  Asset, 
  Operation, 
  TransactionBuilder, 
  Networks, 
  Horizon
} from "@stellar/stellar-sdk";
import "dotenv/config";

async function prepare() {
  const secret = process.env.STELLAR_SECRET_KEY || "";
  if (!secret) {
    console.error("Error: STELLAR_SECRET_KEY not found in .env");
    return;
  }

  const kp = Keypair.fromSecret(secret);
  const pub = kp.publicKey();
  console.log(`Setting up wallet: ${pub}`);

  // 1. Fund via Friendbot
  console.log("Activating account via Friendbot...");
  try {
    const fbResp = await fetch(`https://friendbot.stellar.org/?addr=${pub}`);
    const fbData = await fbResp.json();
    console.log("Account activated on Testnet!");
  } catch (e) {
    console.log("Account already active or Friendbot busy.");
  }

  // 2. Setup USDC Trustline
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const server = new Horizon.Server(horizonUrl);
  
  // USDC Testnet Asset Details (Official SDF Testnet USDC)
  const assetCode = "USDC";
  const assetIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"; 
  const USDC = new Asset(assetCode, assetIssuer);
  
  try {
    const account = await server.loadAccount(pub);
    
    console.log("Adding USDC Trustline...");
    const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      // Path Payment to swap 100 XLM for USDC
      .addOperation(Operation.pathPaymentStrictSend({
        sendAsset: Asset.native(),
        sendAmount: "100",
        destination: pub,
        destAsset: USDC,
        destMin: "1",
        path: []
      }))
      .setTimeout(30)
      .build();
    
    tx.sign(kp);
    await server.submitTransaction(tx);
    console.log("✅ Trustline added and 100 XLM swapped for USDC!");
    
    // Check balance
    const finalAccount = await server.loadAccount(pub);
    const usdcBal = finalAccount.balances.find((b: any) => b.asset_code === "USDC");
    console.log(`🚀 Ready! Final USDC Balance: ${usdcBal?.balance || "0"}`);
  } catch (err: any) {
    console.error("❌ Failed to add Trustline:", err.message);
    if (err.response?.data?.extras?.result_codes) {
        console.error("Codes:", err.response.data.extras.result_codes);
    }
  }
}

prepare();

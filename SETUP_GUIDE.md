# Quick Setup (5 minutes)

## Prerequisites
- Node.js 20+
- A testnet Stellar wallet with USDC

## Step 1: Get a testnet wallet
1. Go to https://laboratory.stellar.org
2. Click "Generate Keypair" — save the Secret Key
3. Go to "Fund Account" tab — paste your Public Key to get 10,000 XLM

## Step 2: Get testnet USDC  
1. Go to https://circle.com/faucet or use Stellar Lab
2. Select Stellar testnet
3. Paste your Public Key
4. Receive 10 USDC testnet tokens

## Step 3: Get OpenZeppelin facilitator key (free, instant)
1. Go to https://channels.openzeppelin.com/testnet/gen
2. Copy the API key

## Step 4: Configure .env
cp .env.example .env
# Fill in: STELLAR_SECRET_KEY, X402_FACILITATOR_API_KEY, SELLER_ADDRESS

## Step 5: Run
npm install
npm run build         # compile the project
npm run dev           # starts MCP server + HTTP server
npm run demo-service  # in another terminal — starts the x402-protected price feed
npm run seed          # in another terminal — registers services in Soroban registry

## Step 6: Add to Claude Desktop
[copy the config JSON from README.md]

## Step 7: Ask Claude
"Check my wallet balance"
"List all available x402 services"  
"Call the stellar price feed service"
"Show my payment history"

## Verify payment is real
After calling a service, Claude will show a Stellar Explorer link.
Click it to see the real USDC transfer on testnet.

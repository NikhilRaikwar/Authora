# Authora — Universal x402-Enabled MCP Server Registry for Stellar

## What it is
Authora is the first universal service discovery registry for Stellar x402 micropayments. It bridges AI assistants (Claude, GPT, Gemini) to any x402-monetized Stellar service via the Model Context Protocol (MCP) — dynamically, without hardcoded integrations.

## The problem it solves
- Coinbase's x402 Bazaar exists on Base/EVM but Stellar has no equivalent
- Today's MCP servers for x402 require hardcoding each service URL
- AI agents cannot discover new Stellar x402 services without developer intervention
- Authora makes Stellar x402 services discoverable and callable from any MCP-compatible AI

## Architecture diagram
```text
+-------------------+      +-------------------+      +------------------+
| Claude / GPT / AI |  ->  |    MCP Client     |  ->  |  Authora Server  |
+(Prompt/Execution)-+      +(Manifest Request)-+      +(Tool Generation)-+
                                                             |
                                                             v
+-------------------+      +-------------------+      +------------------+
|   x402 Services   |  <-  |  Authora Client   |  <-  | Soroban Registry |
+(Monetized APIs)---+      +(Stellar Network)--+      +(On-Chain Catalog)+
```

## How it works
1. Service operators register their x402 endpoints in the Soroban registry
2. Authora generates a dynamic MCP tool manifest from all registry entries
3. Any AI agent pointing at Authora can discover, call, and pay for any registered service

## Quick demo (copy-paste ready)

**Claude Desktop Config (`claude_desktop_config.json`)**
```json
{
  "mcpServers": {
    "authora": {
      "command": "node",
      "args": ["/absolute/path/to/authora/dist/index.js"],
      "env": {
        "STELLAR_NETWORK": "stellar:testnet",
        "STELLAR_SECRET_KEY": "YOUR_SECRET_KEY"
      }
    }
  }
}
```

**Prompts to try:**
- *"list all available x402 services"*
- *"search for Stellar news using the search service"*

## Architecture
### Soroban Registry Contract
The core innovation of Authora is its trustless on-chain service catalog with payment verification. By maintaining service entries and payment records directly on the Stellar blockchain, the registry guarantees metadata integrity while ensuring developers are verifiably compensated through the x402 protocol.

### MCP Server (stdio)
Authora features a robust, standard-input/output-driven interface encapsulating 7 core tools:
- **Base Services (3):** Foundation tools from the original MVP for processing generic x402 network requests out-of-the-box.
- **Registry Services (4):** `register_x402_service`, `list_x402_services`, `call_registered_service`, and `get_x402_service_details`. These new tools transform the static base server into a fully dynamic ecosystem.

### HTTP Manifest Endpoint
For distributed agents or setups bypassing stdio MCP execution, a lightweight Express HTTP server is built-in (`GET /manifest`). This instantly serves the dynamic manifest JSON payload natively—complete with an in-memory 30-sec cache—bypassing high-latency contract RPC reads.

## Live Payment Verification
Autora ensures 100% transparency for every transaction. Every payment made by the agent can be independently verified on the Stellar blockchain:
1. **Tool History:** After a `call_registered_service` or `fetch_paid_resource` call, use the `get_payment_history` tool to see the transaction hash.
2. **Blockchain Explorer:** Verify the hash directly at [StellarExpert](https://stellar.expert/explorer/testnet/) (`https://stellar.expert/explorer/testnet/tx/<txHash>`).
3. **Internal Verification:** Use our live demo endpoint for machine-readable proof:
   - `GET http://localhost:3001/demo/verify-payment/<txHash>` (Returns atomic ledger details)

## Resources used
- jamesbachini/x402-mcp-stellar (base repo)
- stellar/x402-stellar monorepo
- x402-stellar npm package
- OpenZeppelin Relayer for mainnet
- Stellar sponsored agent accounts
- Stellar CLI for contract deployment
- Soroban contract authorization docs

## Live testnet contract
REGISTRY_CONTRACT_ID: <leave as placeholder, to be filled after deploy>

## Setup (5 minutes)
1. **Clone the repo:** `git clone <repository_url> authora`
2. **Install dependencies:** `cd authora && npm install`
3. **Configure environment:** Copy `.env.example` to `.env`.
4. **Fund your wallet:** Use the [Stellar Laboratory](https://laboratory.stellar.org/) to create a testnet keypair and fund it via the Friendbot.
5. **Update `.env`:** Fill in your `STELLAR_SECRET_KEY` with the funded testnet account.
6. **Start the server:** `npm run dev`

## License
MIT

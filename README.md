# Authora 🚀 — Universal x402-Enabled AI Service Registry for Stellar

**Authora** is the first universal service discovery and economic reasoning layer for Stellar x402 micropayments. It bridges AI assistants (Claude, GPT, Gemini) to any x402-monetized service via the Model Context Protocol (MCP) — dynamically, without hardcoded integrations.

---

## 💎 The Problem it Solves
- **Fragmented Discovery:** AI agents cannot currently discover new Stellar x402 services without developer intervention.
- **Economic Blindness:** Standard agents don't know their balance or estimated costs before executing paid calls.
- **Trust Gap:** No built-in way to verify that a "payment success" from an API really matches a transaction on the Stellar blockchain.

---

## 🛠️ MCP Tools Suite (10 Production-Ready Tools)

Authora transforms the static x402 protocol into a dynamic agentic economy.

| Category | Tool | Description |
|---|---|---|
| **Discovery** | `list_x402_services` | Queries the Soroban registry for all live monetized services. |
| | `get_mcp_manifest` | Generates a dynamic JSON tool definition from on-chain entries. |
| **Intelligence** | `check_wallet_balance` | **NEW!** Real-time USDC/XLM balance checks via Horizon server. |
| | `estimate_service_cost` | **NEW!** Fuzzy-search cost estimation for multi-tool batches. |
| **Execution** | `call_registered_service` | Automatically handles payment & data fetch from any registered tool. |
| | `fetch_paid_resource` | Direct protocol-level fetch (bypass local proxy/CORS). |
| **Verification** | `get_payment_history` | **NEW!** In-memory session stats and Stellar Explorer receipt links. |
| | `x402_wallet_info` | Wallet configuration and registry contract addresses. |
| | `x402_facilitator_supported`| Diagnostic check for OpenZeppelin bridge support. |

---

## ⛓️ Live On-Chain Transparency
Autora ensures 100% auditability. Every payment made by the agent can be verified:
1. **Tool History:** Use `get_payment_history` to retrieve the Stellar transaction hash.
2. **Blockchain Explorer:** Click the generated links to verify real USDC transfers on [StellarExpert](https://stellar.expert/explorer/testnet/).
3. **Machine Verification:** Our built-in verification engine: `GET /demo/verify-payment/<txHash>`.

---

## 🏗️ Architecture
```text
+-------------------+      +-------------------+      +-------------------+
| Claude / GPT / AI |  ->  |    MCP Client     |  ->  |  Authora Registry  |
| (Prompt & Action) |      | (Tool Execution)  |      |   (MCP Server)    |
+-------------------+      +-------------------+      +---------+---------+
                                                                |
                                                                v
+-------------------+      +-------------------+      +---------+---------+
|   x402 Services   |  <-  |  Authora Client   |  <-  | Soroban Registry  |
| (Paid Data Feeds) |      | (Stellar Payments)|      | (On-Chain Catalog)|
+-------------------+      +-------------------+      +-------------------+
```

---

## 🚀 Quick Setup (5 Minutes)

### 1. Configure Claude Desktop
Add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "authora": {
      "command": "/path/to/nodejs/node.exe",
      "args": ["/absolute/path/to/authora/dist/index.js"],
      "env": {
        "STELLAR_NETWORK": "stellar:testnet",
        "STELLAR_SECRET_KEY": "YOUR_SECRET_KEY",
        "REGISTRY_CONTRACT_ID": "YOUR_CONTRACT_ID",
        "X402_FACILITATOR_URL": "https://channels.openzeppelin.com/x402/testnet",
        "X402_FACILITATOR_API_KEY": "YOUR_OZ_KEY"
      }
    }
  },
  "preferences": {
    "coworkWebSearchEnabled": true,
    "sidebarMode": "chat"
  }
}
```

### 2. Run the Demo Ecosystem
```bash
npm run dev           # Port 3001: Registry & Manifest
npm run demo-service  # Port 3000: x402-Protected Price Feed
```

---

## 📚 Resources
- [Soroban Registry Contract](https://github.com/NikhilRaikwar/Authora/src/contract)
- [Stellar x402 Protocol Implementation](https://github.com/stellar/x402-stellar)
- [OpenZeppelin Bridge Channels](https://channels.openzeppelin.com/)

---

## 📝 License
MIT

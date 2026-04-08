# Authora 🌐 — The x402 Service Registry for Stellar

> Universal MCP-native service discovery and autonomous payment infrastructure. AI agents discover, evaluate, and pay for any Stellar x402 service — without a single hardcoded integration.

**Built for the Agents on Stellar Hackathon · April 2026**

[![Live Contract](https://img.shields.io/badge/Soroban-CAH62...GQ7X-blue)](https://stellar.expert/explorer/testnet/contract/CAH62PSPXNCIGD5F5IWOZEG2QY2ABPMTFFAZXURDGYRXT3AHL725GQ7X)
[![Network](https://img.shields.io/badge/Network-stellar:testnet-green)](https://developers.stellar.org/docs/build/agentic-payments/x402)
[![Protocol](https://img.shields.io/badge/Protocol-x402%20%2B%20MPP-purple)](https://www.x402.org)

---

## The Problem

AI agents can reason, plan, and act — but stop cold when they need to pay for an API call. 
Today's MCP servers hardcode one service URL per server. Agents are economically blind.

**Authora fixes this.** One MCP server. Infinite discoverable paid services. Zero hardcoded URLs.

---

## What Authora Does

1. **Service operators** register any x402 endpoint in the Authora Soroban contract (permissionless, on-chain)
2. **Authora generates** a live MCP tool manifest from all registry entries — dynamically, no code changes
3. **AI agents** using Claude, GPT, or Gemini discover and call any registered service, paying USDC via x402 automatically
4. **Every payment** is verifiable on Stellar Explorer — real USDC, real transactions, not simulated

---

## Architecture

```mermaid
graph TB
    subgraph AI["AI Agent Layer"]
        C[Claude / GPT / Gemini]
    end
    
    subgraph MCP["Authora MCP Server"]
        direction TB
        M[MCP Tool Dispatcher]
        E[estimate_service_cost]
        W[check_wallet_balance]
        L[list_x402_services]
        CALL[call_registered_service]
        PH[get_payment_history]
        MPP[mpp_demo_charge]
    end
    
    subgraph STELLAR["Stellar Network"]
        direction TB
        REG[("Soroban Registry Contract\nCAH62...GQ7X")]
        USDC["USDC\nCBIELTK6..."]
        OZ["OpenZeppelin Facilitator\nchannels.openzeppelin.com"]
    end
    
    subgraph SERVICES["x402 Services"]
        S1["Stellar Space Weather\n0.001 USDC/call"]
        S2["Stellar Price Feed\n0.001 USDC/call"]
        S3["Ecosystem Search\n0.001 USDC/call"]
    end
    
    C -->|"Tool call"| M
    M --> E & W & L & CALL & PH & MPP
    L -->|"list_services()"| REG
    CALL -->|"fetchWithPayment()"| OZ
    OZ -->|"verify + settle"| USDC
    USDC -->|"transfer()"| SERVICES
    CALL -->|"HTTP response"| C
    PH -->|"txHash + Explorer link"| C
    MPP -->|"MPP Charge intent"| STELLAR
    
    style AI fill:#0a0a0a,color:#00e5a0
    style MCP fill:#111,color:#f0ebe0
    style STELLAR fill:#0d1117,color:#7c6bff
    style SERVICES fill:#0a0a0a,color:#f5c058
```

---

## MCP Tools Suite (11 Tools)

| Category | Tool | Description |
|---|---|---|
| **Discovery** | `list_x402_services` | Query Soroban registry for all live services |
| | `get_mcp_manifest` | Generate dynamic JSON tool manifest from on-chain data |
| **Intelligence** | `check_wallet_balance` | Real-time USDC/XLM via Horizon API |
| | `estimate_service_cost` | Total cost estimation before execution |
| **Execution** | `call_registered_service` | Auto-pay any registered service via x402 |
| | `fetch_paid_resource` | Direct x402 fetch for any URL |
| **Verification** | `get_payment_history` | Session log with Stellar Explorer links |
| **Registry** | `register_x402_service` | Register any x402 endpoint on-chain |
| **MPP** | `mpp_demo_charge` | Stripe MPP Charge intent demonstration |
| **Diagnostics** | `x402_wallet_info` | Wallet config and contract addresses |
| | `x402_facilitator_supported` | OZ facilitator health check |

---

## Payment Flow

1. **User:** "Search the Stellar ecosystem for DeFi protocols"
2. **`list_x402_services()`** → discovers "Stellar Ecosystem Search · 0.001 USDC"
3. **`estimate_service_cost()`** → confirms "$0.001 USDC total"  
4. **`call_registered_service()`** → `fetchWithPayment(url)`
    - GET https://xlm402.com/search?q=DeFi
    - 402 Payment Required
    - `ExactStellarScheme.createPaymentPayload()`
    - Soroban auth entry signed with Ed25519 keypair
    - OZ Facilitator verifies + settles USDC on Stellar
    - 200 OK + `PAYMENT-RESPONSE` header with `txHash`
5. **`get_payment_history()`** shows: ✓ Stellar Ecosystem Search | 0.0010000 USDC | `a3f9c2...`

**Every step produces a real Stellar transaction. No mocks.**

---

## Soroban Contract

The AuthoraRegistry contract is deployed on Stellar testnet.
**Contract ID:** `CAH62PSPXNCIGD5F5IWOZEG2QY2ABPMTFFAZXURDGYRXT3AHL725GQ7X`

**Functions:**
- `register_service(caller, entry)` — permissionless service registration
- `list_services(offset, limit)` — paginated service discovery
- `get_service(url)` — individual service lookup
- `record_payment(url, payer)` — on-chain payment counter increment
- `remove_service(caller, url)` — owner-only removal
- `service_count()` — total registry size

[View on StellarExpert →](https://stellar.expert/explorer/testnet/contract/CAH62PSPXNCIGD5F5IWOZEG2QY2ABPMTFFAZXURDGYRXT3AHL725GQ7X)

---

## x402 Integration

x402 is the core payment protocol. Every `call_registered_service` invocation:
1. Makes an HTTP request to the x402-protected endpoint
2. Receives `402 Payment Required` with `PAYMENT-REQUIRED` header
3. `ExactStellarScheme.createPaymentPayload()` signs a Soroban auth entry authorizing a USDC transfer
4. OpenZeppelin facilitator verifies the auth entry signature and submits the transaction
5. USDC (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`) moves on-chain
6. Facilitator returns `PAYMENT-RESPONSE` header with `txHash`
7. Authora records the `txHash` for verification

**Facilitator:** https://channels.openzeppelin.com/x402/testnet

---

## MPP Integration

Authora also demonstrates Stripe's MPP (Machine Payments Protocol) via the `mpp_demo_charge` tool.
MPP differs from x402:
- **x402:** push-based (client signs auth entry, server facilitates)
- **MPP:** pull-based (server pulls payment from client-authorized credential)

Both protocols settle USDC on Stellar. Authora demonstrates both.
[MPP Docs →](https://developers.stellar.org/docs/build/agentic-payments/mpp)

---

## Quick Setup

### Prerequisites
- Node.js 20+
- Funded Stellar testnet wallet
- OpenZeppelin facilitator API key ([free, instant](https://channels.openzeppelin.com/testnet/gen))

### 1. Get testnet wallet + USDC
```bash
# Create keypair at: https://laboratory.stellar.org
# Fund with Friendbot, then get USDC from Circle faucet
# Or run the wallet prep script:
npm run prepare-wallet
```

### 2. Get free OZ API key
[https://channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen)

### 3. Configure
```bash
cp .env.example .env
# Fill in: STELLAR_SECRET_KEY, X402_FACILITATOR_API_KEY, SELLER_ADDRESS
```

### 4. Run
```bash
npm install
npm run dev           # MCP stdio server + HTTP API on :3001
npm run demo-service  # x402 price feed on :3000
npm run seed          # Register services in Soroban registry
```

### 5. Add to Claude Desktop
```json
{
  "mcpServers": {
    "authora": {
      "command": "node",
      "args": ["/absolute/path/to/authora/dist/index.js"],
      "env": {
        "STELLAR_SECRET_KEY": "S...",
        "REGISTRY_CONTRACT_ID": "CAH62PSPXNCIGD5F5IWOZEG2QY2ABPMTFFAZXURDGYRXT3AHL725GQ7X",
        "X402_FACILITATOR_URL": "https://channels.openzeppelin.com/x402/testnet",
        "X402_FACILITATOR_API_KEY": "your-key-here"
      }
    }
  }
}
```

### 6. Test with Claude
- *"Check my wallet balance"*
- *"List all available x402 services"*
- *"Estimate the cost to call the Stellar price feed once"*
- *"Call the Stellar price feed service"*
- *"Show my payment history"*

---

## Live Verification
Every payment Authora makes is publicly verifiable:
1. Ask Claude: *"Show my payment history"*
2. Copy the transaction hash from the output
3. Visit: `https://stellar.expert/explorer/testnet/tx/<txHash>`
4. See the real USDC transfer on Stellar testnet

**Or use our verification endpoint:**
`GET http://localhost:3001/demo/verify-payment/<txHash>`

---

## HTTP API Endpoints

| Endpoint | Description |
|---|---|
| `GET /manifest` | Dynamic MCP tool manifest (30s cache) |
| `GET /services` | Paginated service registry |
| `GET /payments` | Live payment feed + stats |
| `GET /payments/stats` | Aggregate payment statistics |
| `GET /demo/verify-payment/:txHash` | On-chain transaction verification |
| `POST /services/register` | Register service (operator auth required) |

---

## Known Limitations
- `record_payment` in the Soroban contract has no caller auth — any address can increment the counter. Production version would restrict this to a trusted operator.
- MPP integration is a demonstration of the `Charge` intent pattern; full MPP Session (payment channels) requires the `one-way-channel` Soroban contract.
- Dashboard payment feed is in-memory (session-scoped); data resets on server restart.

---

## Resources Used
- **x402 on Stellar** — core protocol
- **x402-mcp-stellar** — base MCP server
- **stellar/x402-stellar** — monorepo + examples
- **Built on Stellar Facilitator** — OZ relayer
- **MPP on Stellar** — MPP integration
- **Stellar sponsored accounts** — wallet onboarding
- **Stellar CLI** — contract deployment
- **Soroban authorization** — auth entries

---

## License
MIT

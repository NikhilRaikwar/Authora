# Authora Hackathon Submission

**Project Name:** Authora
**Track:** Infrastructure / Ecosystem Tooling

## x402 Usage
Authora seamlessly interacts with the x402 protocol through its Model Context Protocol (MCP) implementations. The specific trigger point is the `call_registered_service` tool:
When an AI agent requests to use this MCP tool, the internal client invokes `fetchWithx402`. The process initiates a standard HTTP request to the target x402 endpoint, catches the resulting x402 `402 Payment Required` challenge, constructs a valid atomic Stellar transaction with the `signAuthEntry` pattern via `@stellar/stellar-sdk`, negotiates the fulfillment with the network, and completes the HTTP response dynamically yielding the paid API results back to the LLM agent.

**Protocol Hardening Fix:**
Payments use only the official Circle Soroban USDC SAC (CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA). The `ExactStellarScheme` signs Soroban auth entries only — the OpenZeppelin x402 facilitator submits the final transaction on-chain to ensure zero-fee client friction.

## MPP Usage
Authora integrates Stripe's Machine Payments Protocol (MPP) via two components:

**Server side** (`scripts/demo-service.ts`): The `/mpp-data` endpoint uses `Mppx` from `mppx/server` 
with `stellar.charge()` from `@stellar/mpp/charge/server`. This creates a pull-based payment gate 
where the server validates incoming MPP payment signatures.

**Client side** (`src/mpp/mpp-client.ts`): The `mpp_demo_charge` MCP tool uses `Mppx.create()` 
from `mppx/client` with `stellar.charge()` from `@stellar/mpp/charge/client` to automatically 
handle 402 MPP challenges from the server endpoint.

**Protocol difference vs x402:**
- **x402**: push-based — client signs Soroban auth entry, pushes signed transaction to facilitator.
- **MPP**: pull-based — server holds a charge session, client authorizes server to pull payment.

Both protocols settle USDC (SAC: CBIELTK6...) on Stellar testnet.

## Soroban Usage
We built the `AuthoraRegistry` smart contract from scratch directly onto Soroban. It operates securely as a global `Map` maintaining decentralized entries of verified x402 endpoints (`ServiceEntry`). Crucially, we enforce that anyone can register a service without permission, provided they maintain an ownership mapping with strict metadata bounds (ensuring JSON schemas cannot exceed network scale arrays). Additionally, we've developed an access-controlled `record_payment` method that maintains an on-chain ledger count of verified successful executions, inherently generating trust scores for paid endpoints in an automated API economy.

## Novel Contribution
The key innovation of Authora lies in its completely **dynamic MCP tool generation**. Typical MCP servers are static binaries with hard-coded endpoints. The Authora server features a dedicated internal registry client that retrieves real-time service listings from our on-chain Soroban contract. It instantly translates Soroban `stringified` schemas back to standardized JSON-schema logic, turning active on-chain entries directly into callable, living functions exposed to your local Claude/GPT desktop applications. We completely detached API listings from local infrastructure. 

## Live Contract
Testnet Contract ID: `CAH62PSPXNCIGD5F5IWOZEG2QY2ABPMTFFAZXURDGYRXT3AHL725GQ7X`

## Demo Video
[🔗 Watch the Demonstration Video Here](#) *(Replace with live video link)*

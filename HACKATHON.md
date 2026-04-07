# Authora Hackathon Submission

**Project Name:** Authora
**Track:** Infrastructure / Ecosystem Tooling

## x402 Usage
Authora seamlessly interacts with the x402 protocol through its Model Context Protocol (MCP) implementations. The specific trigger point is the `call_registered_service` tool:
When an AI agent requests to use this MCP tool, the internal client invokes `fetchWithx402`. The process initiates a standard HTTP request to the target x402 endpoint, catches the resulting L402 `402 Payment Required` challenge, constructs a valid atomic Stellar transaction with the `signAuthEntry` pattern via `@stellar/stellar-sdk`, negotiates the fulfillment with the network, and completes the HTTP response dynamically yielding the paid API results back to the LLM agent.

## MPP Usage
Authora actively leverages Soroban's infrastructure and the Stellar SDK, but specific usage of the MagicBlock Ephemeral Rollups (MPP) extension was deferred in favor of prioritizing the native network throughput and compatibility stability during this build phase.

## Soroban Usage
We built the `AuthoraRegistry` smart contract from scratch directly onto Soroban. It operates securely as a global `Map` maintaining decentralized entries of verified x402 endpoints (`ServiceEntry`). Crucially, we enforce that anyone can register a service without permission, provided they maintain an ownership mapping with strict metadata bounds (ensuring JSON schemas cannot exceed network scale arrays). Additionally, we've developed an access-controlled `record_payment` method that maintains an on-chain ledger count of verified successful executions, inherently generating trust scores for paid endpoints in an automated API economy.

## Novel Contribution
The key innovation of Authora lies in its completely **dynamic MCP tool generation**. Typical MCP servers are static binaries with hard-coded endpoints. The Authora server features a dedicated internal registry client that retrieves real-time service listings from our on-chain Soroban contract. It instantly translates Soroban `stringified` schemas back to standardized JSON-schema logic, turning active on-chain entries directly into callable, living functions exposed to your local Claude/GPT desktop applications. We completely detached API listings from local infrastructure. 

## Live Contract
Testnet Contract ID: `CAH62PSPXNCIGD5F5IWOZEG2QY2ABPMTFFAZXURDGYRXT3AHL725GQ7X`

## Demo Video
[🔗 Watch the Demonstration Video Here](#) *(Replace with live video link)*

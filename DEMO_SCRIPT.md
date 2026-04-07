# Authora — Demonstration Script

## 0:00–0:20: Problem statement
"Today, AI agents can't easily discover or pay for premium APIs. They require developers to hardcode integrations one by one. Authora solves this by putting x402-monetized services on a unified, on-chain Stellar registry."

## 0:20–0:50: Agent without Authora
*(Screen showing Claude Desktop with NO Authora config)*
**User:** Can you list any x402 services available or search for Stellar news?
**Claude:** I don't have access to any external databases or x402 services that allow me to do that...
**Narrator:** "Without our dynamic registry, Claude is completely blind to the paid API economy."

## 0:50–1:20: Adding Authora to Claude
*(Screen transitions to Claude Desktop configuration file)*
**Narrator:** "By adding the Authora server to Claude's config, we grant it access to the Soroban registry contract."
*(User restarts Claude and types: "list all available x402 services")*
Claude immediately utilizes the `list_x402_services` tool and returns the dynamically generated manifest, displaying tools like 'Stellar Observatory' and 'xlm402 Demo Search'.

## 1:20–1:50: Executing a paid service call
*(User prompts: "Search the Stellar ecosystem for the latest decentralized projects")*
Claude evaluates the tools, recognizes the price, and triggers the `call_registered_service` tool.
*(Visuals show the terminal logs firing the x402 L402 challenge)*
**Narrator:** "Claude handles the negotiation autonomously, paying the service fee on the Stellar Testnet in real-time."
*(Result instantly appears in Claude from the paid endpoint. Shows quick cut to Stellar Explorer verifying the transaction hash)*

## 1:50–2:00: Verification on Soroban
*(Screen flashes the Soroban explorer showing the registry contract state increment)*
**Narrator:** "The registry isn't just a list—it actively tracks verified payments, creating an honest, on-chain reputation system for the agentic economy."

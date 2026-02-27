# CREsolver — Trustless Prediction Market Resolution with Verifiable AI Agents

## The Problem

Prediction markets today depend on centralized oracles or small committees to resolve outcomes. This creates a single point of failure: if the oracle is compromised, biased, or offline, the entire market breaks.

At the same time, AI agents are increasingly making decisions with real economic impact — but they have **no on-chain identity, no reputation, and no accountability**. Anyone can spin up an agent, claim it's trustworthy, and resolve markets with zero verifiability.

## The Solution

**CREsolver** is a decentralized prediction market resolution protocol powered by:

- **ERC-8004 Verifiable Agents** — Each AI agent has an on-chain identity with portable, multi-dimensional reputation. You don't trust the agent — you verify it.
- **Chainlink CRE (Compute Runtime Environment)** — Provides the off-chain compute layer that orchestrates agent workflows, triggered by on-chain events.
- **BFT Consensus** — Multiple agents independently research a question, then reach Byzantine-fault-tolerant consensus on the answer. No single agent controls the outcome.

## Why Agents + Prediction Markets?

| Agents need... | Markets need... | ERC-8004 provides... |
|---|---|---|
| On-chain identity | Trustless resolution | Portable agent identity |
| Accountability for decisions | Verifiable oracle outputs | Multi-dimensional reputation |
| Discoverable endpoints | Decentralized infrastructure | Endpoint discovery registry |

Prediction markets are the ideal proving ground for verifiable agents. Every resolution is a public, measurable act — agents build reputation through accuracy, not marketing.

## Architecture

```
User creates market on-chain (CREsolverMarket.sol)
        │
        ▼
1. Market Created → Workers join with ERC-8004 identity
        │
        ▼
2. requestResolution() → Emits event → Chainlink CRE Log Trigger
        │
        ▼
3. CRE Workflow: Agents independently research the question
   ├── Agent Alpha: Searches news, analyzes data
   ├── Agent Beta: Cross-references sources
   └── Agent Gamma: Validates methodology
        │
        ▼
4. BFT Consensus: 2/3 must agree on YES/NO + quality scores
        │
        ▼
5. CRE writes report → CREReceiver → resolveMarket()
        │
        ▼
6. On-chain: Resolution stored, rewards distributed, reputation updated
        │
        ▼
7. BinaryMarket: Users settle bets, claim winnings
```

## The ERC-8004 Differentiator

ERC-8004 is an emerging standard for agent identity on Ethereum. CREsolver is one of the first real implementations.

- **Portable Identity**: An agent's reputation travels across protocols. A CREsolver agent that resolves markets well could be trusted in other contexts.
- **Multi-Dimensional Reputation**: Not just "good/bad" — we track resolution quality, source quality, and analysis depth independently.
- **Endpoint Discovery**: Any protocol can discover and verify agent capabilities through the registry.
- **Ownership & Authorization**: Agents are assets. The owner controls which addresses can operate the agent.

## vs Competition

| | CREsolver | Polymarket | Augur | UMA |
|---|---|---|---|---|
| Resolution | AI agent consensus | Centralized UMA oracle | Forked REP voting | Optimistic oracle + DVM |
| Agent Identity | ERC-8004 (on-chain) | N/A | N/A | N/A |
| Reputation | Multi-dimensional, portable | None | REP token (one dimension) | None |
| Compute Layer | Chainlink CRE | Off-chain | On-chain | Off-chain |
| Incentive | Worker rewards + settlement fees | Trading fees | REP staking | Bond + dispute |
| Open Resolution | Anyone can trigger | Admin only | Token holders | Anyone (bond required) |

## Business Model

1. **Resolution-as-a-Service**: Other prediction market protocols can use CREsolver's agent network to resolve their markets. The infrastructure is protocol-agnostic.
2. **Settlement Fees**: 1% of betting pools goes to whoever triggers settlement — creating a competitive market for settlement speed.
3. **Agents as Assets**: ERC-8004 agents with high reputation become valuable. They can be operated, delegated, or potentially transferred.
4. **Worker Economy**: Agents stake ETH to participate in resolution, earn rewards proportional to their quality scores, and build reputation over time.

## Demo Flow

1. **Create a prediction market** — "Will ETH hit $10k by end of 2026?" with 0.01 ETH reward pool
2. **Place bets** — Users buy YES or NO positions with ETH via BinaryMarket
3. **Request resolution** — Anyone calls `requestResolution()` which triggers the CRE pipeline
4. **Watch agents work** — Three ERC-8004 agents independently research, then reach BFT consensus
5. **Settlement & payout** — Resolution stored on-chain. Settler earns 1% fee. Winners claim proportional share.

## Technical Stack

| Component | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.24, Foundry |
| Market Contract | CREsolverMarket.sol (create, join, resolve, reputation) |
| Betting Contract | BinaryMarket.sol (bet YES/NO, settle, claim) |
| Agent Identity | ERC-8004 Identity Registry (Sepolia) |
| Agent Reputation | ERC-8004 Reputation Registry (Sepolia) |
| Compute Layer | Chainlink CRE (EVM Log Trigger → Workflow → WriteEVM) |
| Agent Runtime | TypeScript + Anthropic Claude API |
| Consensus | BFT protocol (2f+1 agreement) |
| Frontend | Next.js 15, viem, TailwindCSS |
| Network | Ethereum Sepolia testnet |

## Links

- **Dashboard**: Live at Vercel — view markets, agent reputation, pipeline status
- **ERC-8004**: [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004)
- **Chainlink CRE**: Compute Runtime Environment for decentralized off-chain compute

---

*Built for the Chainlink + ERC-8004 hackathon. CREsolver demonstrates that prediction markets don't need to choose between decentralization and intelligence — verifiable AI agents provide both.*

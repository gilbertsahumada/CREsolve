# CREsolver

Decentralized prediction market resolution with [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) verifiable agents and **Chainlink CRE as the trustless compute layer** — AI agents investigate, challenge, and reach BFT consensus inside a DON TEE, with rewards and reputation settled on-chain.

## ERC-8004: Verifiable Agent Standard

CREsolver is built on **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)**, the standard for verifiable agents on EVM. Every worker agent has an on-chain identity and reputation managed through two ERC-8004 registries:

- **IdentityRegistry** (`0x8004A818BFB912233c491871b3d84c89A494BD9e`) — Agents register via `register()`, receive an `agentId` (NFT), and store their metadata + service endpoints in `tokenURI`. The CRE workflow reads `tokenURI` to discover each agent's A2A endpoint at runtime.
- **ReputationRegistry** (`0x8004B663056A597Dffe9eCcC1965A193B7388713`) — After each resolution, the CRE workflow writes multi-dimensional reputation scores on-chain via `giveFeedback()`. Scores accumulate across resolutions and are publicly queryable via `getSummary()`.

Key ERC-8004 features used:
- **On-chain endpoint discovery** — Agent HTTP endpoints are stored in `tokenURI` as a `registration-v1` JSON with a `services` array
- **EIP-712 wallet binding** — `setAgentWallet()` uses EIP-712 structured data signing to cryptographically bind an agent identity to a worker wallet
- **Authorization gates** — `isAuthorizedOrOwner()` ensures only registered agents can join markets via `joinMarket()`
- **Multi-dimensional reputation** — 3 on-chain scores (Resolution Quality, Source Quality, Analysis Depth) written per resolution round

View agents on the [Trust8004 Explorer](https://www.trust8004.xyz).

## Architecture

```
  ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
  │ Market Created │────►│ Agents Join    │────►│ requestResolu- │
  │ Question + ETH │     │ + Stake ETH    │     │ tion()         │
  │ reward pool    │     │ (ERC-8004 ID)  │     │ (anyone calls) │
  └────────────────┘     └────────────────┘     └───────┬────────┘
                                                        │ on-chain event
                                                        ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                    Chainlink DON (TEE)                      │
  │                                                             │
  │  CRE Workflow                                               │
  │                                                             │
  │  1. READ       Read market data from chain                  │
  │                                                             │
  │  2. ASK        Each agent researches  ──────────────────────┼──►┌──────────────┐
  │                independently                                │   │  AI Agents   │
  │  3. CHALLENGE  Agents defend their  ────────────────────────┼──►│ (Cloudflare) │
  │                evidence                                     │   │  ERC-8004    │
  │                                                             │   │  Verified    │
  │                                                             │   └──────────────┘
  │  4. EVALUATE   LLM scores each agent  ──────────────────────┼──►┌──────────────┐
  │                8 dims → 3 on-chain scores                   │   │     LLM      │
  │                (via Confidential HTTP,                      │   │ Confidential │
  │                 API key in DON Vault)                       │   │ HTTP + Vault │
  │                                                             │   └──────────────┘
  │  5. CONSENSUS  BFT — 2 out of 3 must agree                  │
  │                                                             │
  │  6. WRITE      DON-signed report                            │
  │                                                             │
  └────────────────────────────┬────────────────────────────────┘
                               │
                               ▼
                  ┌──────────────────────┐
                  │ CREReceiver          │
                  │ resolveMarket()      │
                  └──────────┬───────────┘
                             ▼
                  ┌──────────────────────┐
                  │ On-Chain Settlement  │
                  │ • Rewards distributed│
                  │ • Stakes returned    │
                  │ • Reputation updated │
                  │   (ERC-8004)         │
                  │ • Bets settled       │
                  │   (1% settler fee)   │
                  └──────────────────────┘
```

### Sequence Diagram

```
  Anyone        Contract        CRE Workflow (DON TEE)       AI Agents        LLM
    │               │                    │                      │               │
    │ requestReso-  │                    │                      │               │
    │ lution()      │                    │                      │               │
    │──────────────►│                    │                      │               │
    │               │                    │                      │               │
    │               │  ResolutionReques- │                      │               │
    │               │  ted event         │                      │               │
    │               │───────────────────►│                      │               │
    │               │                    │                      │               │
    │               │  1. READ market    │                      │               │
    │               │◄───────────────────│                      │               │
    │               │  question,workers  │                      │               │
    │               │───────────────────►│                      │               │
    │               │                    │                      │               │
    │               │                    │  2. ASK              │               │
    │               │                    │  POST /a2a/resolve   │               │
    │               │                    │─────────────────────►│               │
    │               │                    │  determination,      │               │
    │               │                    │  evidence, sources   │               │
    │               │                    │◄─────────────────────│               │
    │               │                    │                      │               │
    │               │                    │  3. CHALLENGE        │               │
    │               │                    │  POST /a2a/challenge │               │
    │               │                    │─────────────────────►│               │
    │               │                    │  defense responses   │               │
    │               │                    │◄─────────────────────│               │
    │               │                    │                      │               │
    │               │                    │  4. EVALUATE         │               │
    │               │                    │  all evidence +      │               │
    │               │                    │  challenge responses │               │
    │               │                    │  (Confidential HTTP) │               │
    │               │                    │─────────────────────────────────────►│
    │               │                    │  8 quality scores    │               │
    │               │                    │  per agent           │               │
    │               │                    │◄─────────────────────────────────────│
    │               │                    │                      │               │
    │               │                    │  5. CONSENSUS        │               │
    │               │                    │  (BFT 2/3 agree)     │               │
    │               │                    │  8 dims → 3 on-chain │               │
    │               │                    │                      │               │
    │               │  6. WRITE          │                      │               │
    │               │  DON-signed report │                      │               │
    │               │◄───────────────────│                      │               │
    │               │                    │                      │               │
    │               │  resolveMarket()   │                      │               │
    │               │  • rewards         │                      │               │
    │               │  • stakes returned │                      │               │
    │               │  • reputation      │                      │               │
    │               │    updated (8004)  │                      │               │
    │               │                    │                      │               │
```

| Directory | Description |
|-----------|-------------|
| `contracts/` | Solidity (Foundry) — `CREsolverMarket`, `CREReceiver`, `ReceiverTemplate` |
| `agent/` | TypeScript/Hono worker agent with mock + LLM modes |
| `agent-cloudflare/` | Cloudflare Worker version of the A2A agent (production) |
| `cre-workflow/` | CRE resolution workflow (TypeScript SDK, compiles to WASM for DON) |
| `frontend/` | Read-only Next.js frontend — Sepolia markets, agents, reputation |
| `e2e/` | End-to-end test suite (Docker Compose + Anvil + Vitest) |
| `scripts/` | Automation — setup, deploy, registration, verification |
| `docs/` | Architecture, hackathon one-pager, judge setup, privacy roadmap |

## Quick Start

```bash
# 1. Clone and install dependencies
git clone <repo-url> && cd cresolver
cd agent && yarn install && cd ..
cd agent-cloudflare && yarn install && cd ..
cd scripts && yarn install && cd ..
cd e2e && yarn install && cd ..
cd cre-workflow && yarn install && cd ..
cd cre-workflow/cresolver-resolution && yarn install && cd ../..

# 2. Install Foundry dependencies
cd contracts && forge install && cd ..

# 3. Run the full E2E suite (starts Anvil + 3 agents via Docker)
yarn e2e
```

This single command orchestrates:
1. `yarn e2e:up` — Starts Docker Compose (Anvil on port 8547 + 3 agents on 3101-3103)
2. `yarn e2e:setup` — Deploys contracts, creates markets, registers workers
3. `yarn e2e:test` — Runs 18 integration tests via Vitest
4. `yarn e2e:down` — Stops all containers

## Command Map

```bash
# E2E
yarn e2e                    # full lifecycle

# Sepolia
yarn sepolia:wallets        # generate worker wallets
yarn sepolia:sync           # canonical ERC-8004 register/normalize flow
yarn sepolia:audit          # strict on-chain audit
yarn sepolia:deploy         # deploy contracts + create market
yarn sepolia:demo-markets   # create 6 demo markets

# Workflow
yarn workflow:simulate:sepolia       # simulate against Sepolia (real agents)
yarn workflow:simulate:sepolia-mock  # simulate with mock responses

# Frontend
yarn frontend:dev           # local dev server
yarn frontend:build         # static export (Vercel)

# Tests
yarn e2e                    # E2E (Docker + Vitest)
yarn agent:test             # agent unit tests
yarn agent:cf:test          # Cloudflare agent tests
yarn workflow:typecheck     # CRE workflow typecheck
```

For local simulation, Sepolia setup, and step-by-step verification, see [docs/JUDGE_SETUP.md](docs/JUDGE_SETUP.md).

## Resolution Pipeline

The CRE workflow executes a 6-step resolution pipeline:

1. **READ** — Read market data from on-chain (question, workers, stakes)
2. **ASK** — Query each worker agent via `POST /a2a/resolve` (requires BFT quorum: ⌈2n/3⌉ responses)
3. **CHALLENGE** — Cross-examine agents via `POST /a2a/challenge`
4. **EVALUATE** — Score workers across 3 public dimensions (Resolution Quality, Source Quality, Analysis Depth), compute consensus
5. **RESOLVE** — Determine final resolution and reward weights
6. **WRITE** — Submit DON-signed report on-chain via `CREReceiver`

### Workflow Triggers

The CRE workflow supports **two triggers** simultaneously:

| Trigger | How it fires | Use case |
|---------|-------------|----------|
| **EVM Log Trigger** | Automatically when `requestResolution()` emits `ResolutionRequested(uint256,string)` | Production — fully autonomous, no manual intervention |
| **HTTP Trigger** | `POST` with `{ "market_id": N }` signed by `authorizedEVMAddress` | Demo & testing — trigger resolution on demand |

For the hackathon demo we use the **HTTP Trigger** to control timing and show the pipeline step-by-step. In production, the **EVM Log Trigger** makes the system fully autonomous — resolution starts the moment `requestResolution()` is called on-chain.

### BFT Quorum

CREsolver requires a **⌈2n/3⌉ BFT supermajority** of worker responses before proceeding — the same threshold used by Chainlink OCR, PBFT, and Tendermint. With 3 workers, at least 2 must respond. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full quorum table.

### Privacy Model

- **Confidential HTTP** — LLM calls use `ConfidentialHTTPClient` with DON Vault secret injection (API keys never leave the TEE)
- **TEE isolation** — Individual agent determinations, evidence, and raw LLM scores only exist inside the enclave during execution
- **Public results** — Resolution (YES/NO) and aggregated reputation scores are intentionally on-chain and auditable

See [ARCHITECTURE.md § Transparency and Privacy](docs/ARCHITECTURE.md) for details on why we don't use `encryptOutput`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_PORT` | `3001` | Port the agent listens on |
| `AGENT_NAME` | `"Worker"` | Agent display name |
| `LLM_API_KEY` | `""` | LLM API key (empty = mock mode) |
| `LLM_MODEL` | `"meta/llama-3.3-70b-instruct"` | LLM model for investigation (NVIDIA NIM) |

Agents run in **mock mode** by default (deterministic, no API key). Set `LLM_API_KEY` for real LLM investigation.

## Frontend

Read-only frontend for visualizing CREsolver markets and agents on Sepolia. No wallet required.

```bash
yarn frontend:dev    # local dev server
yarn frontend:build  # static export (Vercel)
```

## Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System architecture, resolution pipeline, contracts, scoring, privacy model






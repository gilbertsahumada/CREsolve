# CREsolver

Decentralized prediction market resolution powered by **Chainlink CRE** (Compute Runtime Environment) and **AI worker agents**.

CRE workflows orchestrate multiple AI agents to investigate market questions, challenge each other's determinations, and reach multi-dimensional consensus — all executed inside a Chainlink DON with results written on-chain.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  CREsolverMarket │◄────│   CREReceiver    │◄────│  KeystoneForwarder│
│  (Solidity)      │     │  (DON bridge)    │     │  (Chainlink DON) │
└──────┬───────────┘     └──────────────────┘     └────────┬─────────┘
       │                                                    │
       │ events                                    DON-signed reports
       │                                                    │
       ▼                                                    │
┌──────────────────┐     ┌──────────────────┐              │
│  CRE Workflow    │────►│  Worker Agents   │              │
│  (TypeScript)    │     │  (Hono/OpenAI)   │◄─────────────┘
│  6-step pipeline │     │  /a2a/resolve    │
│  runs in DON TEE │     │  /a2a/challenge  │
└──────────────────┘     └──────────────────┘
```

| Directory | Description |
|-----------|-------------|
| `contracts/` | Solidity (Foundry) — `CREsolverMarket`, `CREReceiver`, `ReceiverTemplate` |
| `agent/` | TypeScript/Hono worker agent with mock + LLM (OpenAI) modes |
| `cre-workflow/` | CRE resolution workflow (TypeScript SDK, compiles to WASM for DON) |
| `e2e/` | End-to-end test suite (Docker Compose + Anvil + Vitest) |
| `scripts/` | Demo automation — deploy, setup markets, run resolution |
| `shared/` | Shared TypeScript interfaces |

## Command Map

```bash
# Local demo
yarn local:setup
yarn local:demo

# Full E2E
yarn e2e

# Sepolia helpers
yarn sepolia:wallets
yarn sepolia:sync        # canonical full flow
yarn sepolia:normalize   # normalize existing agent IDs
yarn sepolia:audit       # strict on-chain audit
yarn sepolia:deploy
yarn sepolia:verify
```

## Prerequisites

- **Node.js** 18+ (20 recommended)
- **Yarn** (package manager)
- **Foundry** — `forge`, `cast`, `anvil` ([install](https://book.getfoundry.sh/getting-started/installation))
- **Docker & Docker Compose** — for E2E tests
- **CRE CLI** (optional) — for deploying workflows to a Chainlink DON

## Quick Start

```bash
# 1. Clone and install dependencies
git clone <repo-url> && cd cresolver
cd agent && yarn install && cd ..
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
2. `yarn e2e:setup` — Runs the shared setup script in `e2e` profile (deploy + workers + markets + requests)
3. `yarn e2e:test` — Runs 18 integration tests via Vitest
4. `yarn e2e:down` — Stops all containers

## Running Tests

### Contract Tests (Foundry)

```bash
cd contracts
forge test -vvv
```

Tests cover `CREsolverMarket` (market lifecycle, staking, resolution, reputation) and `CREReceiver` (report decoding, forwarding).

### Agent Tests (Vitest)

```bash
cd agent
yarn test
```

Unit tests for the worker agent covering health checks, resolve/challenge endpoints, and validation.

### E2E Tests (Docker + Vitest)

```bash
# Full lifecycle (recommended)
yarn e2e

# Or step-by-step:
yarn e2e:up       # Start containers
yarn e2e:setup    # Deploy & setup
yarn e2e:test     # Run tests
yarn e2e:down     # Cleanup
```

18 integration tests covering agent health, market resolution workflows, receiver path, and edge cases. Timeout: 120s per test.

### CRE Workflow Typecheck

```bash
cd cre-workflow/cresolver-resolution
yarn typecheck
# or from root
yarn workflow:typecheck
```

## Demo Scripts

For running a local demo outside Docker:

```bash
# 1. Start a local Anvil node
anvil

# 2. Start 3 agents (in separate terminals)
cd agent
AGENT_PORT=3001 AGENT_NAME=Alpha yarn start
AGENT_PORT=3002 AGENT_NAME=Beta  yarn start
AGENT_PORT=3003 AGENT_NAME=Gamma yarn start

# 3. Deploy contracts and create demo markets
yarn local:setup

# 4. Run resolution for a market (default: market 0)
yarn local:demo
yarn local:demo -- 1   # specific market
yarn local:demo -- 2
```

`setup-demo.ts` is the shared bootstrap entrypoint for both local and E2E profiles.
It deploys `CREsolverMarket`, creates 3 markets, funds workers, and writes the target config file.
`demo-run.ts` reads the config, queries agents, and executes the local workflow runner.

### Sepolia Setup

```bash
# 1. Generate 3 worker wallets
yarn sepolia:wallets

# 2. Fill contracts/.env with DEPLOYER_KEY + SEPOLIA_RPC
# 3. Canonical flow (register missing IDs + set agentURI + setAgentWallet + approve + verify)
yarn sepolia:sync

# 4. Normalize existing deployed agents without re-registering IDs
yarn sepolia:normalize

# 5. Verify wallets/agent auth and export public judge file
yarn sepolia:verify --public-out sepolia-agents.public.json

# 6. Strict on-chain audit (state + tokenURI template + agentWallet alignment)
yarn sepolia:audit --min-eth 0.01

# 7. Deploy contracts + create market + auto-join workers
yarn sepolia:deploy
```

Metadata schema source of truth:
- `scripts/agent-profile.ts` (registration-v1 JSON + on-chain metadata keys)
Canonical agent sync implementation:
- `scripts/sync-agents.ts` (full + normalize modes)

## Project Structure

```
cresolver/
├── package.json                 # Root scripts (yarn e2e)
├── docker-compose.e2e.yml       # Anvil + 3 agents
│
├── contracts/                   # Foundry project
│   ├── src/
│   │   ├── CREsolverMarket.sol  # Market + staking + reputation
│   │   ├── CREReceiver.sol      # DON report bridge
│   │   └── interfaces/
│   │       ├── IReceiver.sol
│   │       └── ReceiverTemplate.sol
│   ├── test/
│   │   ├── CREsolverMarket.t.sol
│   │   └── CREReceiver.t.sol
│   └── script/
│       └── Deploy.s.sol
│
├── agent/                       # Worker agent (TypeScript/Hono)
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.ts             # Hono server entry
│   │   ├── config.ts            # Environment config
│   │   ├── validation.ts        # Zod schemas
│   │   ├── routes/
│   │   │   ├── health.ts        # GET /health
│   │   │   └── a2a.ts           # POST /a2a/resolve, /a2a/challenge
│   │   └── services/
│   │       ├── investigator.ts  # Mock + LLM investigation
│   │       └── defender.ts      # Challenge defense
│   └── tests/
│       └── agent.test.ts
│
├── cre-workflow/                # Chainlink CRE workflow
│   ├── project.yaml             # CRE project metadata
│   ├── secrets.yaml
│   └── cresolver-resolution/
│       ├── workflow.yaml        # Workflow definition
│       ├── config.json          # Agent endpoints & EVM config
│       ├── main.ts              # Entry (EVM Log + HTTP triggers)
│       ├── types.ts             # Config & response schemas
│       ├── agents.ts            # HTTP client for workers
│       ├── evm.ts               # On-chain read/write client
│       └── evaluate.ts          # Consensus & scoring logic
│
├── scripts/                     # Demo automation
│   ├── setup-demo.ts            # Shared setup (local/e2e via --profile)
│   ├── demo-run.ts              # Execute resolution
│   ├── workflow-runner.ts       # Local 6-step runner used by demo-run.ts
│   ├── generate-wallets.ts      # Sepolia worker wallet generation
│   ├── sync-agents.ts           # Canonical ERC-8004 register/normalize flow
│   ├── audit-agents-onchain.ts  # Strict on-chain audit for ERC-8004 alignment
│   ├── verify-agents.ts         # Wallet/auth verification + public export
│   └── demo-config.json         # Generated by setup
│
├── e2e/                         # E2E test suite
│   ├── vitest.e2e.config.ts
│   ├── e2e.test.ts              # 18 integration tests
│   ├── helpers.ts               # Polling & verification utils
│   └── workflow-runner.ts       # Local CRE DON simulator
│
├── shared/
│   └── types.ts                 # Shared TypeScript interfaces
│
└── docs_final/                  # Architecture documentation
    ├── BLUEPRINT.md
    ├── EXECUTION_PLAN.md
    ├── JUDGE_SETUP.md
    ├── IMPLEMENTATION_GUIDE.md
    ├── HACKATHON_ONE_PAGER.md
    ├── PRIVACY_ROADMAP.md
    └── EIP712_DEEP_DIVE.md
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_PORT` | `3001` | Port the agent listens on |
| `AGENT_NAME` | `"Worker"` | Agent display name |
| `LLM_API_KEY` | `""` | OpenAI API key (empty = mock mode) |
| `LLM_MODEL` | `"gpt-4o-mini"` | LLM model for investigation |
| `RPC_URL` | `http://127.0.0.1:8545` | Ethereum JSON-RPC endpoint |
| `KEYSTONE_FORWARDER` | `address(0)` | KeystoneForwarder contract (deploy script) |
| `DIRECT_RESOLVER` | `address(0)` | Direct resolver signer (deploy script) |

### Agent Modes

- **Mock mode** (default): Deterministic responses, no API key needed. Ideal for testing.
- **LLM mode**: Set `LLM_API_KEY` to an OpenAI key. The agent uses the model specified in `LLM_MODEL` to investigate questions and defend challenges.

### CRE Workflow Config (`cre-workflow/cresolver-resolution/config.json`)

```json
{
  "evms": [{
    "chain_selector": 31337,
    "market_address": "0x...",
    "receiver_address": "0x...",
    "gas_limit": 500000
  }],
  "agents": [
    { "name": "Alpha", "endpoint": "http://127.0.0.1:3101" },
    { "name": "Beta",  "endpoint": "http://127.0.0.1:3102" },
    { "name": "Gamma", "endpoint": "http://127.0.0.1:3103" }
  ]
}
```

### Demo Config (`scripts/demo-config.json`)

Generated by `yarn local:setup` (or `cd scripts && yarn setup`). Contains RPC URL, deployed contract address, worker wallets (Anvil HD keys), and market count. Do not commit — it is gitignored.

## API Reference

### `GET /health`

```json
{ "status": "ok", "agent": "Alpha", "mode": "mock" }
```

### `POST /a2a/resolve`

```json
// Request
{ "market_id": 0, "question": "Will bitcoin reach 200k by end of 2026?" }

// Response
{ "determination": true, "confidence": 0.85, "evidence": "...", "sources": ["..."] }
```

### `POST /a2a/challenge`

```json
// Request
{ "challenges": ["What evidence supports your determination?"] }

// Response
{ "responses": ["Based on market trends and..."] }
```

## Resolution Pipeline

The CRE workflow executes a 6-step resolution pipeline:

1. **READ** — Read market data from on-chain (question, workers, stakes)
2. **ASK** — Query each worker agent via `POST /a2a/resolve`
3. **CHALLENGE** — Cross-examine agents via `POST /a2a/challenge`
4. **EVALUATE** — Score workers across 3 public dimensions (Resolution Quality, Source Quality, Analysis Depth), compute consensus
5. **RESOLVE** — Determine final resolution and reward weights
6. **WRITE** — Submit DON-signed report on-chain via `CREReceiver`

## Detailed Documentation

For comprehensive architecture and implementation details:

- **[BLUEPRINT.md](docs_final/BLUEPRINT.md)** — System architecture, design decisions, on-chain/off-chain dimension model
- **[IMPLEMENTATION_GUIDE.md](docs_final/IMPLEMENTATION_GUIDE.md)** — Full implementation reference with code, progress tracking, and deployment guide
- **[HACKATHON_ONE_PAGER.md](docs_final/HACKATHON_ONE_PAGER.md)** — Jury/demo one-page source of truth (architecture + algorithm + E2E checklist)
- **[PRIVACY_ROADMAP.md](docs_final/PRIVACY_ROADMAP.md)** — Phased privacy design (Confidential HTTP first, private rewards later)
- **[EXECUTION_PLAN.md](docs_final/EXECUTION_PLAN.md)** — Phased execution plan (Option A/B/C + Thursday checklist)
- **[JUDGE_SETUP.md](docs_final/JUDGE_SETUP.md)** — Minimal setup/verification guide for judges
- **[EIP712_DEEP_DIVE.md](docs_final/EIP712_DEEP_DIVE.md)** — Detailed EIP-712 guide + exact `setAgentWallet` usage in this repo

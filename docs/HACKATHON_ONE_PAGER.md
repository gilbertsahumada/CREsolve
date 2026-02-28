# CREsolver — Hackathon One Pager

Short document for demo, judges, and execution.

## 1) What is CREsolver

CREsolver resolves prediction markets using **verifiable AI agents** built on the **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** standard:
- ERC-8004 agents register on-chain, exposing identity + service endpoints + reputation;
- a Chainlink CRE workflow discovers agents via ERC-8004 `tokenURI`, orchestrates evaluation and BFT consensus;
- on-chain settlement distributes rewards and writes ERC-8004 reputation scores.

Result: final resolution + reward distribution + per-agent verifiable reputation.

### Key Technologies
- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** — The standard for verifiable agents on EVM. Provides on-chain identity (IdentityRegistry), endpoint discovery (tokenURI), wallet binding (EIP-712), and multi-dimensional reputation (ReputationRegistry)
- **Chainlink CRE** — Compute Runtime Environment, executes the resolution workflow inside a DON TEE
- **BFT Quorum** — ⌈2n/3⌉ supermajority (same as Chainlink OCR, PBFT, Tendermint)
- **Cloudflare Workers** — Production deployment for AI agents
- **NVIDIA NIM** — LLM evaluation via meta/llama-3.3-70b-instruct
- **[Trust8004](https://www.trust8004.xyz)** — Public explorer for ERC-8004 agent identities and reputation

## 2) Architecture (source of truth)

- `contracts/src/CREsolverMarket.sol`: market, stake, rewards, reputation.
- `contracts/src/CREReceiver.sol`: KeystoneForwarder bridge → `resolveMarket`.
- `cre-workflow/cresolver-resolution/main.ts`: pipeline READ → ASK → CHALLENGE → EVALUATE → RESOLVE → WRITE.
- `cre-workflow/cresolver-resolution/evaluate.ts`: canonical scoring algorithm.
- `agent/src/routes/a2a.ts`: endpoints `POST /a2a/resolve` and `POST /a2a/challenge`.
- `agent-cloudflare/`: Cloudflare Workers production deployment.
- `frontend/`: Read-only Next.js frontend (Sepolia data via viem).
- `scripts/setup-demo.ts`: shared setup (`--profile local|e2e`).
- `e2e/e2e.test.ts`: E2E suite (18 tests).

Full architecture: [docs/ARCHITECTURE.md](ARCHITECTURE.md)

## 3) Agentic End-to-End Flow

1. Market created and workers `joinMarket`.
2. `requestResolution(marketId)` emitted.
3. CRE workflow reads market/workers/reputation.
4. Workflow discovers agent endpoints via ERC-8004 `tokenURI`.
5. Workflow queries each worker (`/a2a/resolve`) — BFT quorum required.
6. Workflow challenges responses (`/a2a/challenge`).
7. Workflow evaluates quality per worker and calculates weighted consensus.
8. Workflow reports (`runtime.report`) → forwarder → receiver.
9. `resolveMarket` distributes rewards, returns stakes, and updates ERC-8004 reputation.

### Workflow Triggers

The workflow supports two triggers:
- **EVM Log Trigger** — Production: fires automatically on `ResolutionRequested` event, fully autonomous.
- **HTTP Trigger** — Demo: fires on demand via signed HTTP POST, allows controlled step-by-step demonstration.

For the hackathon demo we use the **HTTP Trigger** to control timing. In production, the EVM Log Trigger makes resolution fully autonomous.

## 4) A2A Protocol

- Current: Simple HTTP interface over Hono/Cloudflare Workers with stable JSON contract.
- Positioned as "A2A-lite" — decoupled agentic interaction protocol by endpoint and typed payload.
- Post-hackathon: can wrap in formal A2A envelope without breaking business logic.

## 5) CRE + TEE: Privacy by Design

CREsolver uses two levels of CRE privacy:

**1. Secret injection (Confidential HTTP)**
- `CRE_NVIDIA_API_KEY` is stored in DON Vault and injected at runtime via `vaultDonSecrets`
- The LLM call uses `ConfidentialHTTPClient` — the API key never appears in code, logs, or node memory
- Agent queries use regular `HTTPClient` since endpoints are public (ERC-8004 `tokenURI`)

**2. TEE isolation (intermediate data)**
- Individual agent determinations, evidence, and sources only exist inside the TEE during execution
- The LLM returns 8 raw evaluation dimensions per worker — these are aggregated to 3 scores inside the TEE and never written raw on-chain
- `correctnessMult` (200 if correct, 50 if incorrect) is applied inside the TEE, not stored

**Why no `encryptOutput`?** CRE supports encrypting API responses before they leave the enclave, but CREsolver processes the LLM response inside the workflow (not in an external backend). The CRE docs state: "Do not decrypt inside the workflow." Since we need to aggregate scores in the workflow, and the final output is intentionally public, `encryptOutput` doesn't apply.

**Result**: secret injection for API keys, TEE isolation for intermediate data, public aggregated results on-chain.

## 6) Public Algorithm (open source)

Implemented in `cre-workflow/cresolver-resolution/evaluate.ts`.

```txt
qualityScore = resolutionQuality * 0.4 + sourceQuality * 0.3 + analysisDepth * 0.3
repFactor = ((resRep + srcRep + depthRep)/3)/100 + 0.5   (if count > 0; else 1.0)
voteWeight = qualityScore * repFactor
resolution = sum(voteWeight YES) >= sum(voteWeight NO)
weight = qualityScore * correctnessMult * repFactor
correctnessMult = 200 if correct, 50 if incorrect
```

Public: algorithm, factors, dimensions, `weights[]`, `dimScores[]`, `resolution` on-chain.
Confidential (CRE TEE only): individual determinations, evidence/challenges, `correctnessMult` at runtime.

## 7) E2E Checklist

Prerequisites:
- Docker running.
- Dependencies installed.

Execution:
```bash
yarn e2e:up
yarn e2e:setup
yarn e2e:test
yarn e2e:down
```

Must pass:
- 3 healthy agents (`/health`).
- Complete setup (deploy + 3 markets + join workers + requestResolution).
- 3 complete resolutions (mock markets: bitcoin, ethereum, etf).
- Reputation accumulated correctly.
- Receiver path validated.
- E2E suite green (`18` tests).

## 8) Quality Gate

Before presenting:
```bash
cd contracts && forge test -vvv
cd ../agent && yarn test
cd ../agent-cloudflare && yarn test
cd ../scripts && npx tsc --noEmit
cd ../e2e && npx tsc --noEmit
cd ../cre-workflow/cresolver-resolution && npx tsc --noEmit
cd ../.. && yarn e2e
yarn frontend:build
```

## 9) Dashboard

Live dashboard at the deployed Vercel URL (or run locally with `yarn dashboard:dev`).

Shows: pipeline visualization, agent reputation bars, BFT quorum indicator, market list with status.

## 10) Judge Pitch (30s)

"CREsolver uses ERC-8004 verifiable agents to resolve prediction markets. Each agent has an on-chain identity, discoverable endpoints, and accumulated reputation — all through the ERC-8004 standard. A Chainlink CRE workflow orchestrates investigation, challenge, and BFT consensus inside a DON TEE, then writes resolution results and reputation scores back on-chain. The algorithm is public, the agents are verifiable, and the reputation is permanent."

# CREsolver — Hackathon One Pager

Short document for demo, judges, and execution.

## 1) What is CREsolver

CREsolver resolves prediction markets with:
- AI worker agents that investigate and respond;
- a Chainlink CRE workflow that orchestrates evaluation and consensus;
- on-chain settlement in `CREsolverMarket`.

Result: final resolution + reward distribution + per-worker reputation.

### Key Technologies
- **Chainlink CRE** — Compute Runtime Environment, executes the resolution workflow inside a DON TEE
- **BFT Quorum** — ⌈2n/3⌉ supermajority (same as Chainlink OCR, PBFT, Tendermint)
- **ERC-8004** — On-chain identity + reputation registry for agents
- **Cloudflare Workers** — Production deployment for AI agents
- **NVIDIA NIM** — LLM evaluation via meta/llama-3.3-70b-instruct

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
4. Workflow queries each worker (`/a2a/resolve`) — BFT quorum required.
5. Workflow challenges responses (`/a2a/challenge`).
6. Workflow evaluates quality per worker and calculates weighted consensus.
7. Workflow reports (`runtime.report`) → forwarder → receiver.
8. `resolveMarket` distributes rewards, returns stakes, and updates reputation.

## 4) A2A Protocol

- Current: Simple HTTP interface over Hono/Cloudflare Workers with stable JSON contract.
- Positioned as "A2A-lite" — decoupled agentic interaction protocol by endpoint and typed payload.
- Post-hackathon: can wrap in formal A2A envelope without breaking business logic.

## 5) CRE + TEE: Confidential HTTP & Secrets

- In CRE, HTTP calls execute inside the TEE with secrets from DON vault (no API keys exposed in code/config).
- Output can be encrypted before leaving the enclave (`encryptOutput`).
- Complements CREsolver design: public logic + sensitive data protected at runtime.

References:
- `conf-http-demo`: Chainlink confidential HTTP with secrets and encrypted response.
- `Compliant-Private-Transfer-Demo`: private transfers with permissioning/compliance controls.

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

"The evaluation algorithm is public and auditable in the repo. Agents investigate and challenge each other. The CRE workflow calculates weighted consensus and settles on-chain. In TEE environments we protect sensitive runtime data without hiding the scoring logic."

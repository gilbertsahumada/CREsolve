# CREsolver Architecture

CREsolver is a decentralized prediction market resolution system that combines
AI worker agents, Chainlink CRE (Compute Runtime Environment) workflows, and
on-chain settlement. Workers investigate market questions independently, defend
their findings under cross-examination, and receive quality-weighted rewards
through a transparent scoring algorithm executed inside the CRE DON's Trusted
Execution Environment.

This document consolidates the system's architecture, data flows, contract
design, scoring model, and deployment topology into a single reference.

---

## 1. System Overview

### Architecture Diagram

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  CREsolverMarket │<----│   CREReceiver    │<----│  KeystoneForwarder│
│  (Solidity)      │     │  (DON bridge)    │     │  (Chainlink DON) │
└──────┬───────────┘     └──────────────────┘     └────────┬─────────┘
       │                                                    │
       │ events                                    DON-signed reports
       │                                                    │
       v                                                    │
┌──────────────────┐     ┌──────────────────┐              │
│  CRE Workflow    │────>│  Worker Agents   │              │
│  (TypeScript)    │     │  (Hono/Cloudflare)│<────────────┘
│  6-step pipeline │     │  /a2a/resolve    │
│  runs in DON TEE │     │  /a2a/challenge  │
└──────────────────┘     └──────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Smart Contracts | Solidity (Foundry) | CREsolverMarket, CREReceiver, ERC-8004 integration |
| CRE Workflow | TypeScript SDK | Compiles to WASM for DON execution; 6-step resolution pipeline |
| Worker Agents | TypeScript/Hono (Docker) + Cloudflare Workers | AI investigation and challenge defense |
| LLM | meta/llama-3.3-70b-instruct via NVIDIA NIM | Multi-dimensional evaluation scoring |
| Identity | ERC-8004 | IdentityRegistry (agent registration, EIP-712 wallet binding) + ReputationRegistry |
| Testing | Vitest + Foundry + Docker Compose | Unit, integration, and end-to-end coverage |

### Sepolia Deployments

| Contract | Address |
|----------|---------|
| CREsolverMarket | `0x499B178A5152Fb658dDbA1622B9B29Bb88561863` |
| CREReceiver | `0x81B324C2FA2c092d17752E5998b62A8CceaD2eA4` |
| IdentityRegistry (ERC-8004) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry (ERC-8004) | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Full deployment details including block numbers and transaction hashes are
available in `contracts/DEPLOYMENTS.md`.

---

## 2. End-to-End Flow

A market moves through five phases from creation to withdrawal. Each phase
involves distinct actors and on-chain/off-chain operations.

### Phase 1 -- Setup

1. **Deploy contracts.** The deployer deploys `CREsolverMarket` (with optional
   ERC-8004 registry addresses) and `CREReceiver` (pointing to the market
   contract and the KeystoneForwarder). The deployer then authorizes the
   CREReceiver as a resolver via `setAuthorizedResolver`.

2. **Create a market.** A market creator calls `createMarket(question, duration)`
   with ETH attached as the reward pool. The contract records the question,
   sets the deadline to `block.timestamp + duration`, and returns a `marketId`.

3. **Workers join.** Each worker agent calls `joinMarket(marketId, agentId)`
   with ETH at or above the minimum stake. If the ERC-8004 IdentityRegistry
   is configured, the contract verifies `isAuthorizedOrOwner(msg.sender, agentId)`
   before accepting the worker. Up to 10 workers may join a single market.

**ERC-8004 Identity is optional.** When the IdentityRegistry address is
`address(0)`, any address can join with `agentId=0`. This is the default for
local development and E2E testing.

### Phase 2 -- Trigger

The market creator (or contract owner) calls `requestResolution(marketId)`.
This emits a `ResolutionRequested(uint256 marketId, string question)` event.
The CRE EVM Log Trigger detects this event and starts the resolution workflow.

An HTTP trigger is also supported for manual or programmatic invocation.

### Phase 3 -- Resolution

The CRE workflow executes a 6-step pipeline inside the DON TEE. This is the
core of the system and is described in detail in Section 3.

### Phase 4 -- Settlement

The CRE workflow produces a DON-signed report via `runtime.report()`. The
Chainlink runtime delivers the report through the KeystoneForwarder, which
calls `CREReceiver.onReport(metadata, report)`. The receiver decodes the
report and calls `CREsolverMarket.resolveMarket()`, which:

1. **Distributes rewards** proportionally by weight:
   `reward[i] = rewardPool * weight[i] / totalWeight`.
2. **Returns stakes** to each worker.
3. **Updates internal reputation** as a running average across three dimensions.
4. **Publishes ERC-8004 feedback** (if configured) via three `giveFeedback()`
   calls per worker -- one for each scored dimension.

### Phase 5 -- Post-Settlement

After resolution, workers call `withdraw()` to transfer their accumulated
balance (reward + returned stake) to their wallet. The contract uses a
pull-payment pattern with OpenZeppelin's ReentrancyGuard.

Reputation scores persist across markets. Workers who perform well accumulate
higher reputation, which increases their voting weight in future resolutions.

---

## 3. Resolution Pipeline

The CRE workflow executes six sequential steps for each market resolution.
All steps run inside the DON TEE, ensuring that sensitive intermediate data
(individual determinations, challenge responses, correctness multipliers)
never leaves the trusted environment.

### Step 1 -- READ

Read market data from on-chain using Multicall3 batching:

- `getMarket(marketId)` -- question, reward pool, deadline, creator, resolved status
- `getMarketWorkers(marketId)` -- list of registered worker addresses
- `stakes(marketId, worker)` -- each worker's staked amount
- `getReputation(worker)` -- each worker's three-dimensional reputation scores

The output is a `WorkerData[]` array containing each worker's address, HTTP
endpoint (mapped from config), stake amount, and reputation.

### Step 2 -- ASK

Query each worker via `POST /a2a/resolve` with the market question. Workers
are queried **independently** -- no worker sees another worker's response.
Each worker returns:

- `determination` (boolean) -- YES or NO answer
- `confidence` (0.0 to 1.0) -- self-assessed confidence
- `evidence` (string) -- detailed analysis supporting the determination
- `sources` (string[]) -- URLs or references backing the evidence

The workflow requires a BFT quorum of responses to proceed (see Section 3.1).

### Step 3 -- CHALLENGE

Cross-examine each worker via `POST /a2a/challenge`. The workflow generates
challenge questions based on disagreements among workers, without revealing
which worker said what. If all workers agree, devil's advocate questions are
generated instead.

Each worker receives three challenges and must defend its position. Challenge
responses feed into the evaluation step.

### Step 4 -- EVALUATE

Score each worker across 8 LLM dimensions using meta/llama-3.3-70b-instruct.
The 8 raw scores are aggregated into 3 on-chain scores (see Section 7 for
the full scoring model):

- **resQuality** = (ResolutionQuality x 20 + ReasoningClarity x 15 + EvidenceStrength x 10) / 45
- **srcQuality** = (SourceQuality x 15 + Timeliness x 10) / 25
- **analysisDepth** = (AnalysisDepth x 15 + BiasAwareness x 10 + Collaboration x 5) / 30

The composite quality score is:

```
qualityScore = resQuality * 0.4 + srcQuality * 0.3 + analysisDepth * 0.3
```

### Step 5 -- RESOLVE

Compute the weighted majority vote and blinded on-chain weights.

**Voting.** For each worker, a vote weight is calculated:

```
repFactor = ((resRep + srcRep + depthRep) / 3) / 100 + 0.5   (if count > 0; else 1.0)
voteWeight = qualityScore * repFactor
```

The final resolution is `YES` if the sum of YES vote weights is greater than
or equal to the sum of NO vote weights, and `NO` otherwise.

**Blinded weights.** After the resolution is determined, on-chain weights are
computed with a correctness multiplier that remains private inside the TEE:

```
correctnessMult = 200 (if worker's determination matches resolution)
correctnessMult =  50 (if worker's determination disagrees)
weight = qualityScore * correctnessMult * repFactor
```

The correctness multiplier is never published on-chain. An observer sees
`weights[]`, `dimScores[]`, and `resolution`, but cannot deterministically
reverse-engineer individual determinations when three or more workers
participate (multiple weight combinations produce the same ratios).

### Step 6 -- WRITE

Submit the DON-signed report on-chain:

1. Encode the payload: `abi.encode(marketId, workers[], weights[], dimScores[], resolution)`
2. Sign via DON: `runtime.report(prepareReportRequest(encodedPayload))`
3. Write to chain: `evmClient.writeReport(runtime, { receiver, report, gasConfig })`

The KeystoneForwarder delivers the report to CREReceiver, which decodes it
and calls `resolveMarket()`.

### 3.1 BFT Quorum

CREsolver uses a BFT supermajority quorum of ceil(2n/3) -- the same threshold
used by Chainlink CRE's OCR (Off-Chain Reporting) protocol and classic BFT
consensus algorithms (PBFT, Tendermint, HotStuff).

In a system with n participants, up to f = floor((n-1)/3) may be faulty
(offline, slow, or malicious). The remaining n - f honest participants form
a supermajority that guarantees:

- **Safety:** No conflicting resolutions can both reach quorum.
- **Liveness:** The system makes progress even with f failures.

This is the theoretical optimum -- tolerating more faults would require
sacrificing one of these guarantees (FLP impossibility).

| Workers | Quorum (ceil 2n/3) | Fault Tolerance |
|--------:|-------------------:|----------------:|
|       1 |                  1 |               0 |
|       2 |                  2 |               0 |
|       3 |                  2 |               1 |
|       4 |                  3 |               1 |
|       5 |                  4 |               1 |
|       6 |                  4 |               2 |
|       7 |                  5 |               2 |
|       8 |                  6 |               2 |
|       9 |                  6 |               3 |
|      10 |                  7 |               3 |

**Implementation:** `cre-workflow/cresolver-resolution/resolution/quorum.ts`

---

## 4. Smart Contracts

All contracts are located in `contracts/src/`. This section describes their
responsibilities and interfaces without reproducing full source code.

### 4.1 CREsolverMarket.sol

**Location:** `contracts/src/CREsolverMarket.sol`

Standalone contract that integrates market management, worker registration,
escrow, resolution settlement, and reputation tracking in a single deployment.
Inherits from OpenZeppelin's `Ownable` and `ReentrancyGuard`.

**Core functions:**

| Function | Description |
|----------|-------------|
| `createMarket(question, duration)` | Creates a market with `msg.value` as the reward pool and `block.timestamp + duration` as the deadline. Returns the new `marketId`. |
| `joinMarket(marketId, agentId)` | Worker stakes ETH to participate. Validates minimum stake, market activity, and (if configured) ERC-8004 identity ownership. Maximum 10 workers per market. |
| `resolveMarket(marketId, workers, weights, dimScores, resolution)` | Distributes rewards proportionally by weight, returns stakes, updates reputation. Callable only by authorized resolvers. |
| `requestResolution(marketId)` | Emits `ResolutionRequested` event for the CRE EVM Log Trigger. Callable by market creator or contract owner. |
| `withdraw()` | Transfers accumulated balance to caller. Uses pull-payment pattern with reentrancy protection. |
| `setAuthorizedResolver(resolver, authorized)` | Owner grants or revokes resolver permissions. |
| `getMarket(marketId)` | Returns market struct (question, reward pool, deadline, creator, resolved). |
| `getMarketWorkers(marketId)` | Returns array of worker addresses registered for a market. |
| `getReputation(worker)` | Returns running-average reputation across three dimensions plus resolution count. |

**Data model:**

- `Market` struct: question, rewardPool, deadline, creator, resolved
- `Reputation` struct: resQualitySum, srcQualitySum, analysisDepthSum, count
- State mappings: markets, stakes, worker lists, agent IDs, balances, authorized resolvers, reputation

**Reputation accumulation:** Each `resolveMarket` call adds the worker's three
dimension scores to running sums and increments the count. `getReputation()`
returns the average (sum/count) for each dimension.

**ERC-8004 integration:** Both the IdentityRegistry and ReputationRegistry are
optional constructor parameters. When the IdentityRegistry is configured,
`joinMarket` verifies agent ownership. When the ReputationRegistry is
configured, `resolveMarket` publishes three `giveFeedback()` calls per worker
(one per scored dimension).

**Validations in `resolveMarket`:**
1. Market exists (deadline > 0)
2. Market not already resolved
3. Worker count within MAX_WORKERS (10)
4. Workers, weights, and dimScores arrays are consistent
5. Caller is an authorized resolver
6. Every worker in the array has a registered stake

### 4.2 CREReceiver.sol

**Location:** `contracts/src/CREReceiver.sol`

Bridge between the Chainlink KeystoneForwarder and CREsolverMarket. Extends
ReceiverTemplate and implements `_processReport()` to decode the DON-signed
report payload and forward it to `resolveMarket()`.

**Report decoding:** The report is ABI-decoded as
`(uint256 marketId, address[] workers, uint256[] weights, uint8[] dimScores, bool resolution)`.

**Authorization chain:**
1. KeystoneForwarder calls `CREReceiver.onReport()` -- msg.sender is the forwarder
2. ReceiverTemplate validates the forwarder address and optional workflow identity
3. CREReceiver calls `CREsolverMarket.resolveMarket()` -- msg.sender is the receiver
4. CREsolverMarket checks `authorizedResolvers[msg.sender]`

### 4.3 ReceiverTemplate.sol

**Location:** `contracts/src/interfaces/ReceiverTemplate.sol`

Abstract base contract implementing the Chainlink CRE receiver pattern
(ERC-165 `IReceiver` interface). Provides:

- Forwarder address validation (`msg.sender == forwarder`)
- Metadata decoding (workflowId, donId, optional workflowOwner)
- Optional workflow identity enforcement via a whitelist
- Admin functions: `setForwarder`, `allowWorkflow`, `disallowWorkflow`,
  `setEnforceWorkflowIdentity`

Application-specific logic goes in the abstract `_processReport(bytes calldata report)`
method.

### 4.4 ERC-8004 Interfaces

**Location:** `contracts/src/interfaces/erc8004/`

- **IERC8004IdentityV1** -- Agent registration, wallet binding via EIP-712
  signatures, `isAuthorizedOrOwner()` checks, and `tokenURI` for on-chain
  metadata (including service endpoints).
- **IERC8004Reputation** -- On-chain reputation scores via `giveFeedback()`
  and `getReputation()`.

These interfaces are consumed by CREsolverMarket but the registry contracts
themselves are deployed independently at the addresses listed in Section 1.

**Source:** `contracts/src/`
**Deployment details:** `contracts/DEPLOYMENTS.md`

---

## 5. Worker Agents

Two worker agent implementations exist, sharing the same A2A protocol interface.

### 5.1 Docker Agent (agent/)

**Location:** `agent/`

TypeScript/Hono server packaged in a Node 20 Alpine Docker image. Supports
two operational modes:

- **Mock mode** (default, no API key): Deterministic keyword-based responses
  for testing. Returns predictable outcomes based on question content (e.g.,
  "bitcoin" + "200k" returns NO with 0.65 confidence).
- **LLM mode** (with `LLM_API_KEY`): Uses an LLM with `temperature=0` and
  `seed=42` for determinism. Includes retry with exponential backoff.

Both modes implement response caching with a 10-minute TTL, keyed by market
ID. This is critical for CRE consensus -- all DON nodes must receive identical
responses when querying the same agent for the same market.

**Directory structure:**

```
agent/
├── Dockerfile
├── src/
│   ├── index.ts            # Hono server entry point
│   ├── config.ts           # Environment configuration
│   ├── validation.ts       # Zod request schemas
│   ├── routes/
│   │   ├── health.ts       # GET /health
│   │   └── a2a.ts          # POST /a2a/resolve, /a2a/challenge
│   └── services/
│       ├── investigator.ts # Investigation logic (mock + LLM)
│       └── defender.ts     # Challenge defense logic
└── tests/
    └── agent.test.ts
```

### 5.2 Cloudflare Workers Agent (agent-cloudflare/)

**Location:** `agent-cloudflare/`

Production deployment targeting Cloudflare Workers. Implements the same A2A
protocol endpoints with the same request/response schemas. Deployed via
Wrangler.

### 5.3 A2A Protocol

All worker agents expose the following HTTP endpoints:

| Endpoint | Method | Timeout | Purpose |
|----------|--------|---------|---------|
| `/a2a/resolve` | POST | 30 seconds | Investigation -- worker analyzes the market question and returns a determination |
| `/a2a/challenge` | POST | 15 seconds | Defense -- worker defends its determination against challenge questions |
| `/health` | GET | -- | Health check returning agent name and operational mode |

**Resolve request/response:**

```
Request:  { market_id, question, deadline?, context? }
Response: { determination, confidence, evidence, sources }
```

**Challenge request/response:**

```
Request:  { challenges: string[] }
Response: { responses: string[] }
```

**Endpoint discovery:** In production, agent endpoints are discovered on-chain
through the ERC-8004 IdentityRegistry. The `tokenURI` for each agent contains
a registration JSON with a `services` array. The CRE workflow reads
`services[name="A2A"]` to find each agent's HTTP endpoint.

**Full protocol specification:** `AGENT_PROTOCOL.md`

---

## 6. CRE Workflow

The resolution workflow is the off-chain orchestration layer that reads market
data, queries workers, evaluates quality, computes consensus, and submits
the signed resolution report.

**Location:** `cre-workflow/cresolver-resolution/`

### Key Files

| File | Purpose |
|------|---------|
| `main.ts` | Entry point. Defines EVM Log Trigger and HTTP Trigger, orchestrates the 6-step pipeline. |
| `types.ts` | Configuration and response Zod schemas, TypeScript interfaces. |
| `agents/query.ts` | HTTP client for querying workers. Handles quorum checks. |
| `agents/llm.ts` | LLM-based evaluation (meta/llama-3.3-70b-instruct via NVIDIA NIM). |
| `agents/mock.ts` | Mock evaluation for local testing. |
| `agents/validate.ts` | Response validation helpers. |
| `chain/evm.ts` | On-chain read/write using the CRE SDK EVMClient with Multicall3 batching. |
| `resolution/quorum.ts` | BFT quorum calculations (ceil 2n/3). |
| `resolution/evaluate.ts` | Consensus algorithm -- `computeResolution()` and `generateChallenges()`. |

### Triggers

The workflow supports two triggers that both invoke the same resolution
pipeline:

1. **EVM Log Trigger** -- Listens for `ResolutionRequested(uint256, string)`
   events on CREsolverMarket. Extracts `marketId` from the event topics.
2. **HTTP Trigger** -- Accepts `POST` requests with `{ market_id: number }`
   for manual or programmatic invocation.

### Configuration

The workflow reads its configuration from a JSON file validated by Zod at
startup. The config specifies:

- **EVM settings:** chain selector, market contract address, receiver contract
  address, gas limit
- **Agent endpoints:** name and HTTP URL for each worker agent

Three configuration targets are available:

| Target | Config File | Description |
|--------|------------|-------------|
| `local-simulation` | `local.config.json` | Local Anvil chain with local agents |
| `sepolia-mock` | `config.sepolia-mock.json` | Sepolia contracts with local agents in mock mode |
| `staging-settings` | `config.staging.json` | Full Sepolia deployment with LLM-powered agents |

### Workflow Definition

The CRE project metadata (`project.yaml`) and workflow definition
(`workflow.yaml`) wire together the TypeScript entry point, configuration,
and secrets for each target environment.

---

## 7. Scoring and Reputation

### 7.1 Eight LLM Dimensions

The LLM evaluator (meta/llama-3.3-70b-instruct) scores each worker across
eight dimensions on a 0-100 scale:

| # | Dimension | Weight | Evaluated From |
|---|-----------|-------:|----------------|
| 1 | Resolution Quality | 20% | Determination correctness, confidence calibration |
| 2 | Source Quality | 15% | Source diversity, reliability, relevance |
| 3 | Analysis Depth | 15% | Evidence thoroughness, nuance, detail level |
| 4 | Reasoning Clarity | 15% | Evidence structure, logical flow, coherence |
| 5 | Evidence Strength | 10% | Factual backing, verifiability of claims |
| 6 | Bias Awareness | 10% | Uncertainty acknowledgment, counterargument handling |
| 7 | Timeliness | 10% | Recency of sources, use of current data |
| 8 | Collaboration | 5% | Challenge response quality, engagement depth |

### 7.2 Aggregation to Three On-Chain Scores

The eight raw LLM dimensions are aggregated into three on-chain reputation
scores using weighted averages:

**resQuality** (Resolution Quality):

```
resQuality = (ResolutionQuality * 20 + ReasoningClarity * 15 + EvidenceStrength * 10) / 45
```

**srcQuality** (Source Quality):

```
srcQuality = (SourceQuality * 15 + Timeliness * 10) / 25
```

**analysisDepth** (Analysis Depth):

```
analysisDepth = (AnalysisDepth * 15 + BiasAwareness * 10 + Collaboration * 5) / 30
```

Each score is a value between 0 and 100, written on-chain as part of the
`dimScores[]` array and used to update the worker's reputation.

### 7.3 Consensus Algorithm

The consensus algorithm operates in two phases: voting and weight computation.

**Phase 1 -- Weighted Majority Vote:**

```
qualityScore = resQuality * 0.4 + srcQuality * 0.3 + analysisDepth * 0.3

repFactor = ((resRep + srcRep + depthRep) / 3) / 100 + 0.5   (if count > 0)
repFactor = 1.0                                                 (if count == 0)

voteWeight = qualityScore * repFactor

resolution = sum(YES voteWeights) >= sum(NO voteWeights)
```

Workers with no prior reputation history receive a neutral `repFactor` of 1.0.
Workers with strong reputation (e.g., average 80/100) receive a `repFactor`
of 1.3, amplifying their influence. Workers with weak reputation have
diminished influence.

**Phase 2 -- Blinded On-Chain Weights:**

```
correctnessMult = 200   (if worker's determination matches resolution)
correctnessMult =  50   (if worker's determination disagrees)

weight = qualityScore * correctnessMult * repFactor
```

The correctness multiplier creates a 4:1 reward ratio between workers who
reached the correct conclusion and those who did not. This multiplier is
computed inside the TEE and never published on-chain.

**Transparency model:** The algorithm, formulas, and dimension weights are
fully public and auditable in `resolution/evaluate.ts`. When running in the
CRE TEE, the only private data are individual worker determinations, raw
evidence, challenge Q&A, and the correctness multiplier values.

### 7.4 On-Chain Reputation

On-chain, `CREsolverMarket` maintains a running-average reputation per worker:

```
reputation.resQualitySum   += dimScores[i*3 + 0]
reputation.srcQualitySum   += dimScores[i*3 + 1]
reputation.analysisDepthSum += dimScores[i*3 + 2]
reputation.count++
```

`getReputation(worker)` returns `(sum/count, sum/count, sum/count, count)` for
each dimension. This internal reputation feeds into the workflow's `repFactor`
calculation for future resolutions.

When the ERC-8004 ReputationRegistry is configured, `resolveMarket` also
publishes three `giveFeedback()` calls per worker to the external registry,
making reputation portable across protocols.

---

## 8. Frontend

**Location:** `frontend/`

Read-only Next.js 14 frontend that reads directly from Sepolia via viem.
No wallet connection required, no server secrets.

**Stack:**
- Next.js 14 (App Router) with static export
- Tailwind CSS (dark theme)
- viem for on-chain reads
- CSS-only reputation bars (zero charting libraries)

**Components:**
- **Header** -- CREsolver branding and Sepolia network badge
- **PipelineVisualizer** -- Interactive 6-step resolution pipeline display
- **QuorumIndicator** -- BFT ceil(2n/3) visual with dot indicators
- **AgentCard / AgentGrid** -- Agent health status and 3-dimension reputation bars
- **MarketCard / MarketList** -- Market question, status, reward pool, deadline, workers

**Data sources:**
- Sepolia RPC: markets, workers, stakes, reputation via `publicClient.readContract`
- Static config: agent names, addresses, agent IDs from embedded configuration

**Deployment:** Static export deployable to Vercel, Netlify, or any static
hosting. Build with `yarn frontend:build`, output in `frontend/out/`.

Full frontend documentation: `docs/DASHBOARD.md`

---

## 9. Fund Flow

The following illustrates the economic flow for a market with two workers:

```
SETUP
  Creator   -- createMarket{1.00 ETH} --> Market.rewardPool = 1.00 ETH
  Worker A  -- joinMarket{0.01 ETH}   --> stakes[market][A] = 0.01 ETH
  Worker B  -- joinMarket{0.01 ETH}   --> stakes[market][B] = 0.01 ETH

  Contract balance: 1.02 ETH (reward pool + stakes)

RESOLUTION (via CREReceiver)
  totalWeight = weight[A] + weight[B] = 900,000 + 100,000 = 1,000,000

  Worker A: reward = 1.00 * 900,000 / 1,000,000 = 0.90 ETH
            + stake returned                     = 0.01 ETH
            --> balances[A] = 0.91 ETH

  Worker B: reward = 1.00 * 100,000 / 1,000,000 = 0.10 ETH
            + stake returned                     = 0.01 ETH
            --> balances[B] = 0.11 ETH

WITHDRAWAL
  Worker A -- withdraw() --> receives 0.91 ETH
  Worker B -- withdraw() --> receives 0.11 ETH
```

Stakes are always returned regardless of correctness. The reward distribution
is entirely weight-based, and weight incorporates quality, reputation, and
the private correctness multiplier.

---

## 10. Security Model

| Threat | Defense |
|--------|---------|
| Unauthorized caller invokes `resolveMarket` | `authorizedResolvers[msg.sender]` check |
| Unregistered worker included in resolution | `stakes[marketId][worker] == 0` reverts with `UnregisteredWorker` |
| Worker registers twice for same market | `AlreadyJoined` check in `joinMarket` |
| More than 10 workers per market | `TooManyWorkers` check (`MAX_WORKERS = 10`) |
| Double resolution of a market | `AlreadyResolved` check in `resolveMarket` |
| Reentrancy on withdrawal | OpenZeppelin `ReentrancyGuard` |
| Unauthorized forwarder sends report | ReceiverTemplate validates `msg.sender == forwarder` |
| Unauthorized workflow submits report | `enforceWorkflowIdentity` whitelist in ReceiverTemplate |
| Malformed metadata in report | `MetadataTooShort` check (minimum 64 bytes) |
| Vote inference from reward ratios | With 3+ workers, multiple weight combinations produce identical ratios |

---

## 11. Transparency and Privacy

CREsolver is designed around the principle of **public algorithm, private
runtime data**. The scoring logic, dimension weights, and consensus rules
are open-source and auditable. The only data that benefits from confidentiality
is ephemeral runtime state.

### Public by Design

| Data | Location | Public |
|------|----------|--------|
| Evaluation algorithm and weights | Repository (`resolution/evaluate.ts`) | Yes |
| Scoring dimensions and aggregation formulas | Repository and on-chain | Yes |
| `dimScores[]` per worker | On-chain | Yes |
| `weights[]` and final `resolution` | On-chain | Yes |

### Confidential in CRE TEE Runtime

| Data | Location | Confidential | Mechanism |
|------|----------|-------------|-----------|
| NVIDIA API key | DON Vault | Yes | `vaultDonSecrets` — injected at runtime, never in code |
| Individual worker determinations | DON TEE | Yes | Only exists during workflow execution |
| Raw evidence and source materials | DON TEE | Yes | Only exists during workflow execution |
| Challenge questions and defense responses | DON TEE | Yes | Only exists during workflow execution |
| LLM raw evaluation (8 dimensions per worker) | DON TEE | Yes | Aggregated to 3 scores before leaving TEE |
| `correctnessMult` per worker | DON TEE | Yes | Applied inside TEE, not written on-chain |

### Confidential HTTP vs Regular HTTP

The workflow uses two HTTP clients with different privacy guarantees:

| Client | Used for | Why |
|--------|----------|-----|
| `ConfidentialHTTPClient` | LLM evaluation (NVIDIA NIM API) | Protects `NVIDIA_API_KEY` via DON Vault secret injection. Request executes inside the enclave — API key never appears in code, logs, or node memory. |
| `HTTPClient` | Agent queries (`/a2a/resolve`, `/a2a/challenge`) and health checks | Agent endpoints are public (discoverable via ERC-8004 `tokenURI`). Responses are processed inside TEE and never written raw on-chain. |

### Why We Don't Use `encryptOutput`

CRE's Confidential HTTP supports encrypting the API response before it leaves
the enclave (`encryptOutput: true`). CREsolver intentionally does **not** use
this feature because:

1. **We process the LLM response inside the workflow** — The 8-dimension scores
   are aggregated to 3 on-chain scores and used to compute the resolution. The
   CRE docs explicitly state: "Do not decrypt inside the workflow."
2. **The final output is intentionally public** — Resolution (YES/NO) and
   aggregated reputation scores are designed to be on-chain and auditable.
3. **Raw data never leaves the TEE** — Individual agent determinations, evidence,
   and the 8 raw LLM dimensions exist only during workflow execution. They are
   not included in the on-chain report.

The privacy model is: **secret injection for API keys, TEE isolation for
intermediate data, public aggregated results on-chain.**

```
Agent endpoints (public, ERC-8004 tokenURI)
  │
  ▼
┌─────────────────────── DON TEE ───────────────────────┐
│  HTTPClient → agent responses (private, ephemeral)     │
│  ConfidentialHTTPClient → LLM eval (API key protected) │
│  8 raw dimensions → aggregated to 3 scores             │
│  correctnessMult → applied, not stored                 │
└────────────────────────┬──────────────────────────────┘
                         ▼
           On-chain: resolution + 3 scores (public)
```

In local development and E2E testing, all data is visible in logs and
responses. Confidentiality only applies when the workflow executes inside
the CRE DON's TEE.

For a detailed roadmap on extending privacy to HTTP requests and reward
payouts, see `docs/PRIVACY_ROADMAP.md`.

---

## 12. Testing

### Contract Tests

- **CREsolverMarket.t.sol** -- 27 tests covering market lifecycle, staking,
  resolution, reputation accumulation, ERC-8004 integration, and error cases.
- **CREReceiver.t.sol** -- 9 tests covering the full forwarder-to-market
  report flow, access control, metadata validation, and ERC-165 support.

```bash
cd contracts && forge test -vvv
```

### Agent Tests

Unit tests for the worker agent covering health checks, resolve/challenge
endpoints, mock responses, and input validation.

```bash
cd agent && yarn test
```

### CRE Workflow Type Checking

```bash
cd cre-workflow/cresolver-resolution && yarn typecheck
```

### End-to-End Tests

Docker Compose orchestrates an Anvil node and three worker agents. The test
suite deploys contracts, creates markets, joins workers, resolves through the
CREReceiver path, and verifies on-chain state.

| Service | Host Port | Container Port |
|---------|----------:|---------------:|
| Anvil | 8547 | 8545 |
| Agent Alpha | 3101 | 3000 |
| Agent Beta | 3102 | 3000 |
| Agent Gamma | 3103 | 3000 |

```bash
# One-command: up -> setup -> test -> down
yarn e2e
```

The E2E suite includes 18 tests covering:
- Agent health and operational mode verification
- Three independent market resolutions (Bitcoin 200k, Ethereum PoS, Bitcoin ETF)
- Reputation accumulation across sequential resolutions
- Edge cases: consensus handling, weight computation, dimension score aggregation
- CREReceiver report path validation
- Re-resolution rejection (AlreadyResolved)

---

## 13. Repository Structure

```
cresolver/
├── contracts/                          # Foundry project
│   ├── src/
│   │   ├── CREsolverMarket.sol
│   │   ├── CREReceiver.sol
│   │   └── interfaces/
│   │       ├── IReceiver.sol
│   │       ├── ReceiverTemplate.sol
│   │       └── erc8004/
│   │           ├── IERC8004IdentityV1.sol
│   │           └── IERC8004Reputation.sol
│   ├── test/
│   ├── script/
│   └── DEPLOYMENTS.md
├── cre-workflow/
│   ├── project.yaml
│   ├── secrets.yaml
│   └── cresolver-resolution/
│       ├── main.ts
│       ├── types.ts
│       ├── workflow.yaml
│       ├── agents/
│       │   ├── query.ts
│       │   ├── llm.ts
│       │   ├── mock.ts
│       │   └── validate.ts
│       ├── chain/
│       │   └── evm.ts
│       └── resolution/
│           ├── evaluate.ts
│           └── quorum.ts
├── agent/                              # Docker-based worker agent
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── validation.ts
│   │   ├── routes/
│   │   └── services/
│   └── tests/
├── agent-cloudflare/                   # Cloudflare Workers agent
├── frontend/                           # Next.js read-only frontend
│   ├── app/
│   ├── components/
│   └── lib/
├── scripts/                            # Demo and setup automation
├── e2e/                                # E2E test suite (Vitest)
├── shared/                             # Shared TypeScript interfaces
│   └── types.ts
├── docker-compose.e2e.yml
├── AGENT_PROTOCOL.md
└── docs/
    ├── ARCHITECTURE.md                 # This document
    ├── DASHBOARD.md
    ├── HACKATHON_ONE_PAGER.md
    ├── JUDGE_SETUP.md
    └── PRIVACY_ROADMAP.md
```

---

## 14. Environment Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_PORT` | 3001 | Worker agent HTTP port |
| `AGENT_NAME` | "Worker" | Agent display name |
| `LLM_API_KEY` | "" | LLM API key (empty = mock mode) |
| `LLM_MODEL` | "meta/llama-3.3-70b-instruct" | LLM model identifier |
| `RPC_URL` | `http://127.0.0.1:8545` | Ethereum RPC endpoint |
| `KEYSTONE_FORWARDER` | `address(0)` | KeystoneForwarder address (deploy script) |
| `DIRECT_RESOLVER` | `address(0)` | Direct resolver for local demo (deploy script) |
| `ERC8004_IDENTITY` | `address(0)` | ERC-8004 IdentityRegistry address |
| `ERC8004_REPUTATION` | `address(0)` | ERC-8004 ReputationRegistry address |

### Port Assignments

**E2E Docker environment:**

| Service | Host Port | Container Port |
|---------|----------:|---------------:|
| Anvil | 8547 | 8545 |
| Agent Alpha | 3101 | 3000 |
| Agent Beta | 3102 | 3000 |
| Agent Gamma | 3103 | 3000 |

**Local development:**

| Service | Port |
|---------|-----:|
| Anvil | 8545 |
| Agent Alpha | 3001 |
| Agent Beta | 3002 |
| Agent Gamma | 3003 |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| `AGENT_PROTOCOL.md` | Full A2A protocol specification with request/response schemas |
| `docs/DASHBOARD.md` | Frontend architecture, components, and deployment guide |
| `docs/HACKATHON_ONE_PAGER.md` | Quick overview for hackathon judges |
| `docs/JUDGE_SETUP.md` | Setup and verification guide for judges |
| `docs/PRIVACY_ROADMAP.md` | Phased privacy design (Confidential HTTP and reward privacy) |
| `contracts/DEPLOYMENTS.md` | Contract deployment addresses, verification commands, and test market creation |

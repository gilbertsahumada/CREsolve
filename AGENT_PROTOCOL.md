# CRE Agent Protocol Specification

This document defines the protocol that any agent must implement to participate as a worker in the CREsolver resolution market.

## Overview

Workers are AI agents that investigate market questions and defend their findings under challenge. The CRE workflow queries each worker, challenges their responses, then evaluates quality across 8 dimensions before submitting an on-chain resolution.

```
Market Question
  → POST /a2a/resolve   (each worker investigates independently)
  → POST /a2a/challenge  (each worker defends their findings)
  → LLM evaluation       (8 dimensions scored, aggregated to 3 on-chain)
  → On-chain resolution   (weighted vote + reputation update)
```

## Endpoints

### `POST /a2a/resolve` — Investigation

The worker receives a market question and returns its determination.

**Request:**

```json
{
  "market_id": 42,
  "question": "Will bitcoin reach 200k by end of 2026?"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `market_id` | `number` | Yes | On-chain market identifier |
| `question` | `string` | Yes | The market question to investigate |
| `deadline` | `number` | No | Unix timestamp of market deadline |
| `context` | `string` | No | Additional context for the question |

**Response:**

```json
{
  "determination": true,
  "confidence": 0.82,
  "evidence": "Based on current market trends, institutional adoption, and the upcoming halving cycle...",
  "sources": [
    "https://example.com/btc-analysis",
    "https://example.com/market-data"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `determination` | `boolean` | Yes | `true` for YES, `false` for NO |
| `confidence` | `number` | Yes | Confidence level between 0.0 and 1.0 |
| `evidence` | `string` | Yes | Detailed analysis supporting the determination |
| `sources` | `string[]` | Yes | URLs or references backing the evidence |

### `POST /a2a/challenge` — Defense

The worker receives challenges to its determination and must defend its position.

**Request:**

```json
{
  "challenges": [
    "Other workers reached the opposite conclusion. What specific evidence makes you confident that the answer is YES?",
    "Your confidence is 82%. What would need to change for you to reverse your determination?",
    "Identify the weakest point in your analysis and defend it."
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `challenges` | `string[]` | Yes | List of challenge questions to address |

**Response:**

```json
{
  "responses": [
    "The key evidence supporting YES is the historical pattern of post-halving price appreciation...",
    "I would reverse my determination if institutional outflows exceeded $10B in a single quarter...",
    "The weakest point is the regulatory uncertainty, but recent SEC guidance suggests..."
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `responses` | `string[]` | Yes | Ordered responses matching each challenge |

## Scoring Dimensions

The LLM evaluator scores each worker across 8 dimensions (0–100 each):

| # | Dimension | Weight | Evaluated From |
|---|-----------|--------|----------------|
| 1 | Resolution Quality | 20% | Determination correctness, confidence calibration |
| 2 | Source Quality | 15% | Sources array — diversity, reliability, relevance |
| 3 | Analysis Depth | 15% | Evidence thoroughness, nuance, detail level |
| 4 | Reasoning Clarity | 15% | Evidence structure, logical flow, coherence |
| 5 | Evidence Strength | 10% | Factual backing, verifiability of claims |
| 6 | Bias Awareness | 10% | Acknowledging uncertainty, addressing counterarguments |
| 7 | Timeliness | 10% | Recency of sources, use of current data |
| 8 | Collaboration | 5% | Challenge response quality, engagement depth |

### Aggregation to On-Chain Scores

The 8 LLM dimensions are aggregated into the 3 on-chain reputation scores using weighted averages:

**`resQuality`** — Resolution Quality (weighted from 3 dimensions):

```
resQuality = (ResolutionQuality × 20 + ReasoningClarity × 15 + EvidenceStrength × 10) / 45
```

**`srcQuality`** — Source Quality (weighted from 2 dimensions):

```
srcQuality = (SourceQuality × 15 + Timeliness × 10) / 25
```

**`analysisDepth`** — Analysis Depth (weighted from 3 dimensions):

```
analysisDepth = (AnalysisDepth × 15 + BiasAwareness × 10 + Collaboration × 5) / 30
```

These 3 scores (0–100) are written on-chain and update the worker's reputation.

## Compliance Requirements

Agents **must**:

1. **Return valid JSON** matching the schemas above. Invalid or malformed responses cause the worker to be excluded from the resolution round.

2. **Respond within timeout:**
   - `/a2a/resolve`: 30 seconds
   - `/a2a/challenge`: 15 seconds

3. **Use deterministic settings** if backed by an LLM: `temperature=0`, `seed=42`. This ensures DON nodes reach consensus on identical responses.

4. **Provide at least one source** in the resolve response. Workers with zero sources receive minimal Source Quality scores.

5. **Respond to all challenges.** The `responses` array must have the same length as the `challenges` array. Missing responses reduce the Collaboration score.

## Example: Full Worker Lifecycle

```
1. Worker registers on-chain:    market.joinMarket{value: stake}(marketId, agentId)
2. Resolution requested:          ResolutionRequested(marketId, question) event emitted
3. CRE queries worker:            POST /a2a/resolve → determination + evidence
4. CRE challenges worker:         POST /a2a/challenge → defense responses
5. LLM evaluates 8 dimensions:    scores 0–100 per dimension
6. Aggregated to 3 on-chain:      resQuality, srcQuality, analysisDepth
7. Weighted vote determines:      YES/NO resolution
8. On-chain settlement:            rewards distributed, reputation updated
```

## TypeScript Types

For reference, these are the TypeScript interfaces used in the CRE workflow:

```typescript
// Resolve response
interface AgentResolveResponse {
  determination: boolean;
  confidence: number;
  evidence: string;
  sources: string[];
}

// Challenge response
interface AgentChallengeResponse {
  responses: string[];
}
```

# Clawbot / OpenClaw + Moltbook: Technical Overview (Skills, Agent Interaction, Prediction Markets)

## Executive summary

“Clawbot” in practice looks like an ecosystem made of:

- **OpenClaw**: a self-hostable autonomous agent runtime (local execution, persistent sessions, skills, multi-agent routing).
- **Moltbook**: an *agent-first* social network where agents interact through a public REST API (posts, comments, votes, follows, feeds, search).

**Key takeaway:** Moltbook/OpenClaw do **not** appear to ship a **native prediction market** primitive (no orderbooks, contracts, settlement, oracle lifecycle). If you want agents to participate in prediction markets, the realistic approach is to integrate **external platforms** (off-chain or on-chain) as controlled skills/services, with strict key management + policy + human-in-the-loop.

## Core links (primary sources)

- OpenClaw site: https://openclaw.ai/
- OpenClaw docs: https://docs.openclaw.ai/
- OpenClaw repo: https://github.com/openclaw/openclaw
- OpenClaw skills model: https://docs.openclaw.ai/tools/skills
- Moltbook site: https://www.moltbook.com/
- Moltbook API repo: https://github.com/moltbook/api
- Moltbook Auth repo: https://github.com/moltbook/auth
- Moltbook Agent Dev Kit: https://github.com/moltbook/agent-development-kit

---

## 1) Where agents interact (and how coordination works)

### 1.1 OpenClaw: internal multi-agent coordination

OpenClaw supports **multi-agent routing**: multiple isolated agents (separate workspaces/state/credentials/tools) running under a single gateway, with routing rules that map incoming channels/peers to a specific `agentId`.

It also supports:
- **Sub-agents** with separate tool policies/model settings.
- **Agent-to-agent tooling** (often disabled by default in example configs).
- **Heartbeat / scheduled turns**: a periodic “check-in” loop that can run routines automatically (useful for posting, monitoring, etc.).

### 1.2 Moltbook: public “social” interaction

Moltbook is a social network designed for agents (humans can observe; the platform is “agents posting to agents”). Its backend exposes “social primitives” via a REST API:

- Create/read posts
- Create/read nested comments
- Upvote/downvote (karma)
- Follows
- Feeds (personalized)
- Search
- Sub-communities (“submolts”) + subscribe

Authentication is via API key:
- `Authorization: Bearer <token>`

There’s also an official multi-platform SDK (TypeScript/Swift/Kotlin).

---

## 2) Skills in OpenClaw (structure, loading, permissions)

### 2.1 Skill format and loading

A “skill” in OpenClaw is typically a folder with a `SKILL.md` (AgentSkills-compatible) that includes:
- YAML frontmatter metadata (requirements, gating)
- Instructions/tool usage patterns
- Associated scripts/commands

Load precedence generally follows:
1) Bundled skills
2) `~/.openclaw/skills`
3) `<workspace>/skills` (highest priority)

Plugins can also contribute skills via `openclaw.plugin.json`.

### 2.2 Practical taxonomy of skills

Useful buckets for engineering:

- **Read/analysis skills**: consume APIs/feeds, summarize, compute signals (lower risk).
- **Action skills**: execute commands, write files, call external services (higher risk).
- **Scheduler/heartbeat skills**: periodic jobs via heartbeat (monitoring/posting).
- **Bridge skills**: orchestrate a “strict adapter service” that performs sensitive work outside the LLM.

### 2.3 Permissions and operational safety

OpenClaw’s main safety model is configuration-based:
- Allow/deny tool policies (`tools.allow`, `tools.deny`, profiles)
- Optional sandboxing
- Separate “elevated exec” concept (host-level execution gated separately)
- Secrets injection via configuration (env vars / API keys) — requires careful logging hygiene

---

## 3) Prediction markets: is there one “built in”?

### 3.1 What the Moltbook API actually provides

From what’s exposed and documented publicly, Moltbook provides **social** primitives (posts/comments/votes/follows/feeds/search), not market primitives (order placement, contracts, clearing, oracle resolution, settlement).

So: **no evidence of a native integrated prediction market** inside Moltbook/OpenClaw.

### 3.2 How to do prediction markets anyway (external integrations)

If you want “agents + prediction markets”, you integrate an external platform and wrap it as a controlled skill/service, for example:

- **Off-chain / centralized**: Kalshi, Manifold Markets (HTTP + WebSocket; keys; KYC/TOS constraints)
- **Hybrid / on-chain settlement**: Polymarket (CLOB + on-chain components; signing + RPC)
- **Fully on-chain**: Omen (Gnosis / Conditional Tokens + oracle), Zeitgeist (Substrate L1 + SDK)

---

## 4) Recommended architecture for agent-driven prediction market participation

### 4.1 Don’t wire an LLM directly to trading keys

Recommended pattern:

**Skill (LLM orchestration)**  
→ **Market Adapter Service (strict API + validation + audit logs)**  
→ **Executors** (exchange client / RPC client / signer)

Why it matters:
- Deterministic validation (marketId, size, limits, slippage)
- Key isolation (HSM/remote signer/vault)
- “Dry-run / simulate” modes
- Human approval thresholds (2FA / signer confirmation)

### 4.2 Separate reads from writes

Use two different capabilities:
- **Market intel (read-only)**: monitoring, comparing markets, generating summaries
- **Trade exec (write)**: explicitly gated, tightly permissioned

### 4.3 Use verifiable agent identity (optional but helpful)

If you run a shared adapter for multiple Moltbook agents:
- Require Moltbook identity/verification tokens (short-lived)
- Add replay protection + idempotency keys + rate limits

---

## 5) Example: minimal “Market Adapter” API contract

**Auth**
- `POST /v1/auth/moltbook-verify`
  - Input: `{ "identityToken": "..." }`
  - Output: `{ "agentId": "...", "verified": true, "exp": 1700000000 }`

**Market discovery**
- `GET /v1/markets/search?provider=polymarket&q=...`
  - Output: `{ provider, marketId, title, outcomes, price, volume, updatedAt }[]`

**Quote**
- `POST /v1/trades/quote`
  - Input: `{ provider, marketId, side, sizeUsd, maxSlippageBps, ttlMs }`
  - Output: `{ quoteId, expectedFillPrice, feesEstimate, expiresAt }`

**Execute**
- `POST /v1/trades/execute`
  - Input: `{ quoteId, idempotencyKey, confirmation: { humanApproved: true, method: "2fa|signature" } }`
  - Output: `{ status: "submitted|filled|rejected", providerOrderId, txHash? }`

**Error format**
- `{ code, message, details, correlationId }`

---

## 6) Risks and mitigations (high-signal)

1) **Skill supply-chain risk**  
   - Treat third-party skills as untrusted code  
   - Deny-by-default, allowlist, scanning, provenance checks

2) **Prompt-injection via social content**  
   - Don’t allow irreversible actions solely from external content  
   - Require multi-source verification + human approval for “write” actions

3) **Oracle / dispute lifecycle in on-chain markets**  
   - Model challenge windows and settlement timing  
   - Don’t assume instant finality

4) **Regulatory constraints (KYC/TOS) on off-chain markets**  
   - Separate “agent decides” from “human-owned account executes”  
   - Maintain auditable logs, limits, revocation paths

---

## Bottom line

- **Moltbook + OpenClaw**: strong “agent social + skills runtime” primitives.
- **Prediction markets**: not natively integrated; best done via external providers + strict adapter architecture.
- If you want this production-grade, build **read-only intelligence first**, then add execution with:
  - minimal privileges
  - strict validation
  - remote signing / key isolation
  - human-in-the-loop gating

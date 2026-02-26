# CREsolver — Judge Setup & Verification

Quick guide to review the system without friction.

## 1) Dashboard (Fastest Way)

Visit the deployed dashboard to see live data from Sepolia:
- Markets with status, reward pools, and deadlines
- Agent reputation bars (3 on-chain dimensions)
- BFT quorum indicator
- Resolution pipeline visualization

Run locally:
```bash
yarn frontend:dev
# Open http://localhost:3000
```

## 2) Local E2E Flow (Deterministic)

Prerequisites:
- Docker running.
- Dependencies installed in `agent/`, `scripts/`, `e2e/`.

Commands:
```bash
yarn e2e:up
yarn e2e:setup
yarn e2e:test
yarn e2e:down
```

What to validate:
- `e2e:setup` deploys contract, creates 3 markets, and registers 3 workers.
- `e2e:test` passes green (agent health, market resolution, receiver path).

## 3) Sepolia Agent Setup (Wallet/Identity Review)

Generate wallets:
```bash
yarn sepolia:wallets
```

Register agents ERC-8004:
```bash
yarn sepolia:sync
```

Normalize existing agents (without re-registering IDs):
```bash
yarn sepolia:normalize
```

Verify consistency and authorization:
```bash
yarn sepolia:verify
```

Strict on-chain audit (owner, wallet, tokenURI registration-v1, balances):
```bash
yarn sepolia:audit --min-eth 0.01
```

Export public file without private keys:
```bash
yarn sepolia:verify --public-out sepolia-agents.public.json
```

Notes:
- `scripts/sepolia-agents.json` contains private keys (private file).
- `sepolia-agents.public.json` exposes only `name`, `address`, `agentId`.

## 4) Agent Deployment

Worker agents are deployed as **Cloudflare Workers** for production:
```bash
cd agent-cloudflare
yarn deploy
```

Local agents for testing:
```bash
cd agent
AGENT_PORT=3101 AGENT_NAME=Alpha yarn start
AGENT_PORT=3102 AGENT_NAME=Beta  yarn start
AGENT_PORT=3103 AGENT_NAME=Gamma yarn start
```

## 5) Minimum Expected Checks

- Each `privateKey` corresponds to its `address`.
- Each worker has sufficient balance to operate.
- Each worker authorized in IdentityRegistry for its `agentId` (`isAuthorizedOrOwner=true`).
- BFT quorum: at least ⌈2n/3⌉ agents must respond (2/3 for 3 agents).

## 6) Sepolia Reference Deploy

```bash
yarn sepolia:deploy
```

Expected output:
- `CREsolverMarket` deployed;
- Test market created;
- 3 workers `joinMarket` with `agentId`.

## 7) Key Technologies

| Component | Technology |
|-----------|-----------|
| Smart Contracts | Solidity (Foundry) |
| CRE Workflow | TypeScript SDK → WASM |
| Worker Agents | Cloudflare Workers |
| LLM Evaluation | meta/llama-3.3-70b-instruct (NVIDIA NIM) |
| Identity | ERC-8004 IdentityRegistry |
| Reputation | ERC-8004 ReputationRegistry |
| Consensus | BFT ⌈2n/3⌉ supermajority |
| Dashboard | Next.js 14 + viem |

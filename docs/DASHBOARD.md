# CREsolver Dashboard

Read-only frontend for visualizing CREsolver markets and agents on Sepolia testnet.

## Overview

Static Next.js 14 application that reads directly from Sepolia via viem. No wallet connection required, no server secrets. Deployable as a static export on Vercel.

## Stack

- Next.js 14 (App Router) with static export
- Tailwind CSS (dark theme)
- viem for on-chain reads
- Zero charting libraries — CSS-only reputation bars

## Data Sources

| Source | Data | Method |
|--------|------|--------|
| Sepolia RPC | Markets, workers, stakes, reputation | viem publicClient.readContract |
| Static config | Agent names, addresses, agent IDs | Embedded from sepolia-agents.public.json |

## Contract Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| CREsolverMarket | `0x499B178A5152Fb658dDbA1622B9B29Bb88561863` |
| CREReceiver | `0x81B324C2FA2c092d17752E5998b62A8CceaD2eA4` |
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Components

- **Header** — CREsolver branding + Sepolia network badge
- **PipelineVisualizer** — 6-step resolution pipeline (READ -> ASK -> CHALLENGE -> EVALUATE -> RESOLVE -> WRITE)
- **QuorumIndicator** — BFT ceil(2n/3) visual with dot indicators
- **AgentCard / AgentGrid** — Agent health status + 3-dimension reputation bars
- **MarketCard / MarketList** — Market question, status, reward pool, deadline, workers

## Local Development

```bash
# From repo root
yarn frontend:dev

# Or directly
cd frontend && yarn dev
```

## Build & Deploy

```bash
# Build static export
yarn frontend:build

# Output in frontend/out/
# Deploy to Vercel, Netlify, or any static hosting
```

### Vercel Deployment

1. Import the repo on Vercel
2. Set root directory to `frontend`
3. Framework: Next.js
4. Build command: `yarn build`
5. Output directory: `out`

## Configuration

Optional environment variable:
- `NEXT_PUBLIC_RPC_URL` — Override default public Sepolia RPC (see `.env.example`)

## Architecture

```
frontend/
├── app/
│   ├── layout.tsx            # Dark theme, metadata
│   ├── page.tsx              # Main frontend page
│   ├── globals.css           # Tailwind + custom CSS
│   └── changelog/page.tsx    # Version changelog
├── components/
│   ├── Header.tsx
│   ├── PipelineVisualizer.tsx
│   ├── QuorumIndicator.tsx
│   ├── AgentCard.tsx
│   ├── AgentGrid.tsx
│   ├── MarketCard.tsx
│   ├── MarketList.tsx
│   └── StatusBadge.tsx
└── lib/
    ├── config.ts             # Sepolia addresses + agent config
    ├── contracts.ts          # ABI fragments for viem
    ├── types.ts              # TypeScript interfaces
    └── hooks.ts              # React hooks (useMarkets, useReputation)
```

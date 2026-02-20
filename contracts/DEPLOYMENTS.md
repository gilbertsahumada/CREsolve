# CREsolver Contract Deployments

This file is the single source of truth for contract addresses by network.

Use cases:
- You can deploy your own contracts and use your own addresses.
- You can use the official CREsolver deployment addresses once they are published here.

## Current Status

- Official public deployment: pending.
- Until this table is filled, each team/judge should deploy their own instance.

## Deployment Table

| Network | Chain ID | CREsolverMarket | CREReceiver | Deployer | Tx Hash (Market) | Tx Hash (Receiver) | Block | Date (UTC) | Explorer (Market) | Explorer (Receiver) | Verified Source | Status | Notes |
|---|---:|---|---|---|---|---|---:|---|---|---|---|---|---|
| Sepolia | 11155111 | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `pending` | `pending` | Official public deployment (to be announced) |
| Local Anvil | 31337 | `dynamic` | `dynamic` | `local` | `n/a` | `n/a` | `n/a` | `n/a` | `n/a` | `n/a` | `n/a` | `ephemeral` | Created by local/e2e setup scripts |

## How To Deploy Your Own (Sepolia)

Prerequisites:
- `DEPLOYER_KEY` funded with Sepolia ETH
- `SEPOLIA_RPC` set
- worker agents generated and registered (`yarn sepolia:wallets`, `yarn sepolia:register`)

Command:

```bash
cd contracts
DEPLOYER_KEY=0x... forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC --broadcast -vvvv
```

After deployment:
1. Copy addresses and tx hashes from script output.
2. Update the row in this table.
3. Commit the updated file so anyone can use the same addresses.

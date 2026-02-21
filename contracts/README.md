# Contracts

Foundry project for CREsolver smart contracts.

## Files

- `src/CREsolverMarket.sol`: market lifecycle, staking, resolution, balances, reputation.
- `src/CREReceiver.sol`: receiver bridge for DON-signed reports.
- `src/interfaces/ReceiverTemplate.sol`: forwarder/auth/metadata guard for `onReport`.
- `src/interfaces/erc8004/*`: optional ERC-8004 identity/reputation interfaces.
- `script/Deploy.s.sol`: generic deploy script (local or testnet via env vars).
- `script/DeploySepolia.s.sol`: Sepolia flow with `scripts/sepolia-agents.json`.
- `DEPLOYMENTS.md`: public deployment registry and address table by network.
- `SEPOLIA_AGENTS.md`: public table of worker addresses and agent IDs.
- `test/CREsolverMarket.t.sol`: market contract tests.
- `test/CREReceiver.t.sol`: receiver contract tests.
- `test/CREsolverMarketFork.t.sol`: Sepolia fork test against real ERC-8004 registries.

## Commands

```bash
cd contracts

# Build
forge build

# Test
forge test

# Test (recommended in CI/local when using Foundry nightly)
forge test --offline

# Sepolia fork test (real ERC-8004 identity check)
SEPOLIA_RPC=https://... \
FORK_WORKER_ADDRESS=0x... \
FORK_AGENT_ID=123 \
forge test --offline --match-contract CREsolverMarketForkTest -vv

# Deploy generic script
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast

# Deploy Sepolia scenario
forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC --broadcast -vvvv

# Or from repo root (loads contracts/.env automatically)
yarn sepolia:sync
yarn sepolia:normalize
yarn sepolia:audit --min-eth 0.01
yarn sepolia:register
yarn sepolia:metadata
yarn sepolia:verify --public-out sepolia-agents.public.json
yarn sepolia:deploy
```

## Env Vars

- `KEYSTONE_FORWARDER`: forwarder address for `CREReceiver`.
- `DIRECT_RESOLVER`: optional direct resolver address.
- `ERC8004_IDENTITY`: optional identity registry.
- `ERC8004_REPUTATION`: optional reputation registry.
- `DEPLOYER_KEY`: private key used by Foundry scripts on Sepolia.
- `SEPOLIA_RPC`: Sepolia RPC URL for fork tests and deploy scripts.
- `FORK_WORKER_ADDRESS`: worker address that owns/is authorized for `FORK_AGENT_ID` on Sepolia.
- `FORK_AGENT_ID`: ERC-8004 agent id used by fork tests.

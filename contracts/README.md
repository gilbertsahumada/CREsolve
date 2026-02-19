# Contracts

Foundry project for CREsolver smart contracts.

## Files

- `src/CREsolverMarket.sol`: market lifecycle, staking, resolution, balances, reputation.
- `src/CREReceiver.sol`: receiver bridge for DON-signed reports.
- `src/interfaces/ReceiverTemplate.sol`: forwarder/auth/metadata guard for `onReport`.
- `src/interfaces/erc8004/*`: optional ERC-8004 identity/reputation interfaces.
- `script/Deploy.s.sol`: generic deploy script (local or testnet via env vars).
- `script/DeploySepolia.s.sol`: Sepolia flow with `scripts/sepolia-agents.json`.
- `test/CREsolverMarket.t.sol`: market contract tests.
- `test/CREReceiver.t.sol`: receiver contract tests.

## Commands

```bash
cd contracts

# Build
forge build

# Test
forge test

# Deploy generic script
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast

# Deploy Sepolia scenario
forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC --broadcast -vvvv
```

## Env Vars

- `KEYSTONE_FORWARDER`: forwarder address for `CREReceiver`.
- `DIRECT_RESOLVER`: optional direct resolver address.
- `ERC8004_IDENTITY`: optional identity registry.
- `ERC8004_REPUTATION`: optional reputation registry.
- `DEPLOYER_KEY`: private key used by Foundry scripts on Sepolia.

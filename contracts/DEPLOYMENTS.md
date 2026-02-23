# CREsolver Contract Deployments

## How To Deploy Your Own (Sepolia)

Prerequisites:
- `DEPLOYER_KEY` funded with Sepolia ETH
- `SEPOLIA_RPC` set
- worker agents generated and synced (`yarn sepolia:wallets`, `yarn sepolia:sync`)

Command:

```bash
cd contracts
source contracts/.env && forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC --broadcast -vvvv 
```

After deployment:
1. Copy addresses and tx hashes from script output.
2. Update the row in this table.
3. Commit the updated file so anyone can use the same addresses.

## Deployment Table

| Name | Network | Address |
|---|---|---|
| CREsolverMarket | Sepolia | `TBD` |
| CREReceiver | Sepolia | `TBD` |
| CREsolverMarket | Local Anvil | `dynamic` |
| CREReceiver | Local Anvil | `dynamic` |

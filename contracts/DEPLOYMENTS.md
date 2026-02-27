# CREsolver Contract Deployments

## How To Deploy Your Own (Sepolia)

Prerequisites:
- `DEPLOYER_KEY` funded with Sepolia ETH
- `SEPOLIA_RPC` set
- worker agents generated and synced (`yarn sepolia:wallets`, `yarn sepolia:sync`)

Command:

```bash
cd contracts
source .env && forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC --broadcast -vvvv 
```

After deployment:
1. Copy addresses and tx hashes from script output.
2. Update the row in the Deployment Table below.
3. Verify the contracts (see next section).
4. Commit the updated file so anyone can use the same addresses.

## How To Verify Contracts

Prerequisites:
- `ETHERSCAN_API_KEY` set (get one free at [etherscan.io/apis](https://etherscan.io/apis))
- `SEPOLIA_RPC` set

```bash
cd contracts
source .env

# Verify CREsolverMarket
forge verify-contract <MARKET_ADDRESS> CREsolverMarket \
  --rpc-url $SEPOLIA_RPC \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address)" <IDENTITY_REGISTRY> <REPUTATION_REGISTRY>)

# Verify CREReceiver
forge verify-contract <RECEIVER_ADDRESS> CREReceiver \
  --rpc-url $SEPOLIA_RPC \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address)" <MARKET_ADDRESS> <KEYSTONE_FORWARDER>)

# Verify BinaryMarket
forge verify-contract <BINARY_MARKET_ADDRESS> BinaryMarket \
  --rpc-url $SEPOLIA_RPC \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address)" <MARKET_ADDRESS>)
```

Replace `<MARKET_ADDRESS>`, `<RECEIVER_ADDRESS>`, `<BINARY_MARKET_ADDRESS>`, etc. with your actual deployed addresses.

## Create Test Markets

Use `SetupTestMarket.s.sol` to spin up fresh markets on an existing deployment without re-deploying contracts. The script creates a market and has the 3 worker agents join it automatically.

Prerequisites:
- `DEPLOYER_KEY` funded with Sepolia ETH
- `SEPOLIA_RPC` set
- `MARKET_ADDRESS` set to the deployed `CREsolverMarket` address
- Worker agents generated and synced (`yarn sepolia:wallets`, `yarn sepolia:sync`)

Required env vars:
| Variable | Description |
|---|---|
| `DEPLOYER_KEY` | Private key of the market creator |
| `SEPOLIA_RPC` | Sepolia RPC endpoint |
| `MARKET_ADDRESS` | Deployed CREsolverMarket address |

Optional env vars (override defaults):
| Variable | Default | Description |
|---|---|---|
| `QUESTION` | `"Will bitcoin reach 200k by end of 2026?"` | Market question |
| `REWARD_ETH` | `0.01 ether` | Reward pool in wei |
| `DURATION` | `7 days` | Market duration in seconds |
| `STAKE_ETH` | `0.0005 ether` | Per-worker stake in wei |

Command:

```bash
# From repo root:
MARKET_ADDRESS=0x499B178A5152Fb658dDbA1622B9B29Bb88561863 yarn sepolia:market

# Or with custom values:
MARKET_ADDRESS=0x499B... QUESTION="Will ETH hit 10k?" REWARD_ETH=20000000000000000 yarn sepolia:market
```

After the script runs it prints the new market ID. Use that to trigger resolution:

```bash
# via HTTP trigger
curl -X POST <WORKFLOW_URL> -d '{"market_id": <NEW_MARKET_ID>}'
```

## Deployment Table

| Name | Network | Address | Block | Tx |
|---|---|---|---:|---|
| ~~CREsolverMarket v1~~ | Sepolia | ~~`0x499B178A5152Fb658dDbA1622B9B29Bb88561863`~~ | 10322132 | ~~`0x03ac...5c6c`~~ |
| ~~CREReceiver v1~~ | Sepolia | ~~`0x81B324C2FA2c092d17752E5998b62A8CceaD2eA4`~~ | 10322133 | ~~`0xe506...453f`~~ |
| ~~CREsolverMarket v2~~ | Sepolia | ~~`0x9C09e483ecF768392306b358a8609B04e9b28fbb`~~ | — | — |
| ~~CREReceiver v2~~ | Sepolia | ~~`0x33c8832E146CFEc249459a4cEe8ba5DCF6d8AC59`~~ | — | — |
| ~~BinaryMarket v1~~ | Sepolia | ~~`0x56bd6A11bC23e48f0fc0BeA99A9DDCb899A3617c`~~ | — | — |
| CREsolverMarket v3 | Sepolia | [`0x6E61036B4627e7bD0F8157Cf26dafbCCBE43DA96`](https://sepolia.etherscan.io/address/0x6E61036B4627e7bD0F8157Cf26dafbCCBE43DA96) | — | — |
| CREReceiver v3 | Sepolia | [`0xFF10923B5Adbb688BDD789E38b2E8b673e96D1F9`](https://sepolia.etherscan.io/address/0xFF10923B5Adbb688BDD789E38b2E8b673e96D1F9) | — | — |
| BinaryMarket v2 | Sepolia | [`0x7fbAD3cFc3cDa040C208d91c56FcB66dabe184a1`](https://sepolia.etherscan.io/address/0x7fbAD3cFc3cDa040C208d91c56FcB66dabe184a1) | — | — |


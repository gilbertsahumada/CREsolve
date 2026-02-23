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
```

Replace `<MARKET_ADDRESS>`, `<RECEIVER_ADDRESS>`, etc. with your actual deployed addresses.

## Deployment Table

| Name | Network | Address | Block | Tx |
|---|---|---|---:|---|
| CREsolverMarket | Sepolia | [`0x499B178A5152Fb658dDbA1622B9B29Bb88561863`](https://sepolia.etherscan.io/address/0x499B178A5152Fb658dDbA1622B9B29Bb88561863) | 10322132 | [`0x03ac...5c6c`](https://sepolia.etherscan.io/tx/0x03ac636e8dcf873911950632cf8e6dd4ee38c37cc3f6d0778c8806777add5c6c) |
| CREReceiver | Sepolia | [`0x81B324C2FA2c092d17752E5998b62A8CceaD2eA4`](https://sepolia.etherscan.io/address/0x81B324C2FA2c092d17752E5998b62A8CceaD2eA4) | 10322133 | [`0xe506...453f`](https://sepolia.etherscan.io/tx/0xe5068b34f7781f5499a89ee2de35fb4463610bd76aecd2b7c901b550efda453f) |


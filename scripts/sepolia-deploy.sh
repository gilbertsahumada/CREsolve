#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/contracts/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Copy contracts/.env.example to contracts/.env and fill DEPLOYER_KEY + SEPOLIA_RPC."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${DEPLOYER_KEY:-}" || "${DEPLOYER_KEY}" == "0x..." ]]; then
  echo "DEPLOYER_KEY is missing or placeholder in contracts/.env"
  exit 1
fi

if [[ -z "${SEPOLIA_RPC:-}" || "${SEPOLIA_RPC}" == *"YOUR_KEY"* ]]; then
  echo "SEPOLIA_RPC is missing or placeholder in contracts/.env"
  exit 1
fi

if command -v cast >/dev/null 2>&1; then
  CHAIN_ID="$(cast chain-id --rpc-url "$SEPOLIA_RPC" 2>/dev/null || true)"
  if [[ "$CHAIN_ID" != "11155111" ]]; then
    echo "RPC is not Sepolia (expected chainId 11155111, got '${CHAIN_ID:-unknown}')."
    exit 1
  fi
fi

cd "$ROOT_DIR/contracts"
forge script script/DeploySepolia.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast -vvvv

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/contracts/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

cd "$ROOT_DIR/scripts"

# If caller did not provide --rpc-url explicitly, use SEPOLIA_RPC from env when available.
if [[ " $* " != *" --rpc-url "* && -n "${SEPOLIA_RPC:-}" ]]; then
  npx tsx verify-agents.ts --rpc-url "$SEPOLIA_RPC" "$@"
else
  npx tsx verify-agents.ts "$@"
fi

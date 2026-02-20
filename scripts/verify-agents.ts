/**
 * Verify generated Sepolia agents and optionally export a public, redacted file.
 *
 * Checks:
 * 1) privateKey -> address consistency
 * 2) optional on-chain checks (if --rpc-url / SEPOLIA_RPC is provided):
 *    - worker balance
 *    - identityRegistry.isAuthorizedOrOwner(worker, agentId)
 *
 * Usage:
 *   npx tsx scripts/verify-agents.ts
 *   npx tsx scripts/verify-agents.ts --rpc-url https://... --min-eth 0.01
 *   npx tsx scripts/verify-agents.ts --public-out scripts/sepolia-agents.public.json
 */

import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_PATH = resolve(__dirname, "sepolia-agents.json");

const IdentityRegistryABI = [
  "function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool)",
];

interface AgentEntry {
  name: string;
  address: string;
  privateKey: string;
  agentId: number | null;
}

interface SepoliaAgentsConfig {
  network: string;
  chainId: number;
  identityRegistry: string;
  reputationRegistry: string;
  agents: AgentEntry[];
}

interface CliOptions {
  rpcUrl?: string;
  minEth: string;
  publicOut?: string;
}

function parseArgs(argv: string[]): CliOptions {
  let rpcUrl = process.env.SEPOLIA_RPC;
  let minEth = "0.01";
  let publicOut: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rpc-url") {
      rpcUrl = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--min-eth") {
      minEth = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--public-out") {
      publicOut = argv[i + 1];
      i++;
      continue;
    }
  }

  return { rpcUrl, minEth, publicOut };
}

function loadConfig(): SepoliaAgentsConfig {
  try {
    return JSON.parse(readFileSync(AGENTS_PATH, "utf-8"));
  } catch {
    console.error(`Could not read ${AGENTS_PATH}`);
    console.error("Run 'npx tsx scripts/generate-wallets.ts' first.");
    process.exit(1);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const minWei = ethers.parseEther(opts.minEth);

  console.log("\nVerifying sepolia-agents.json\n");
  console.log(`File: ${AGENTS_PATH}`);
  console.log(`Network: ${config.network} (${config.chainId})`);
  console.log(`Identity registry: ${config.identityRegistry}`);

  let provider: ethers.JsonRpcProvider | null = null;
  let identity: ethers.Contract | null = null;
  if (opts.rpcUrl) {
    provider = new ethers.JsonRpcProvider(opts.rpcUrl);
    identity = new ethers.Contract(
      config.identityRegistry,
      IdentityRegistryABI,
      provider,
    );
    const net = await provider.getNetwork();
    console.log(`RPC: ${opts.rpcUrl}`);
    console.log(`Connected chainId: ${net.chainId}\n`);
  } else {
    console.log("RPC: not provided (skipping on-chain checks)\n");
  }

  let hasErrors = false;

  for (const agent of config.agents) {
    const wallet = new ethers.Wallet(agent.privateKey);
    const derivedAddress = wallet.address;
    const addressMatches =
      derivedAddress.toLowerCase() === agent.address.toLowerCase();

    if (!addressMatches) hasErrors = true;

    let balanceWei: bigint | null = null;
    let isAuthorized: boolean | null = null;

    if (provider) {
      balanceWei = await provider.getBalance(agent.address);
      if (agent.agentId !== null && identity) {
        isAuthorized = await identity.isAuthorizedOrOwner(
          agent.address,
          agent.agentId,
        );
        if (!isAuthorized) hasErrors = true;
      }
      if (balanceWei < minWei) hasErrors = true;
    }

    console.log(`- ${agent.name}`);
    console.log(`  address: ${agent.address}`);
    console.log(`  agentId: ${agent.agentId ?? "null"}`);
    console.log(`  key->address: ${addressMatches ? "OK" : "ERROR"}`);

    if (balanceWei !== null) {
      console.log(`  balance: ${ethers.formatEther(balanceWei)} ETH`);
      console.log(`  min required: ${opts.minEth} ETH`);
    }

    if (isAuthorized !== null) {
      console.log(
        `  isAuthorizedOrOwner: ${isAuthorized ? "OK" : "ERROR"}`,
      );
    }

    console.log();
  }

  if (opts.publicOut) {
    const outPath = resolve(__dirname, opts.publicOut);
    const publicView = {
      network: config.network,
      chainId: config.chainId,
      identityRegistry: config.identityRegistry,
      reputationRegistry: config.reputationRegistry,
      generatedAt: new Date().toISOString(),
      agents: config.agents.map((a) => ({
        name: a.name,
        address: a.address,
        agentId: a.agentId,
      })),
    };
    writeFileSync(outPath, JSON.stringify(publicView, null, 2));
    console.log(`Public file written to: ${outPath}\n`);
  }

  if (hasErrors) {
    console.error("Verification finished with errors.");
    process.exit(1);
  }

  console.log("Verification passed.");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});

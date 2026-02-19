/**
 * Generate 3 worker wallets for Sepolia ERC-8004 agent registration.
 *
 * Outputs: scripts/sepolia-agents.json (gitignored — contains private keys)
 *
 * Usage:
 *   npx tsx scripts/generate-wallets.ts
 */

import { ethers } from "ethers";
import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "sepolia-agents.json");

const AGENT_NAMES = ["Alpha", "Beta", "Gamma"];

const SEPOLIA_CONFIG = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
};

function main() {
  if (existsSync(OUTPUT_PATH)) {
    console.error(`\n  sepolia-agents.json already exists at:\n  ${OUTPUT_PATH}`);
    console.error(`\n  Delete it first if you want to regenerate wallets.`);
    console.error(`  WARNING: regenerating will lose access to any funded wallets!\n`);
    process.exit(1);
  }

  console.log("Generating 3 worker wallets for Sepolia...\n");

  const agents = AGENT_NAMES.map((name) => {
    const wallet = ethers.Wallet.createRandom();
    console.log(`  ${name}: ${wallet.address}`);
    return {
      name,
      address: wallet.address,
      privateKey: wallet.privateKey,
      agentId: null as number | null,
    };
  });

  const output = {
    network: "sepolia",
    chainId: 11155111,
    identityRegistry: SEPOLIA_CONFIG.identityRegistry,
    reputationRegistry: SEPOLIA_CONFIG.reputationRegistry,
    agents,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`\n  Saved to: ${OUTPUT_PATH}`);
  console.log(`  (This file is gitignored — it contains private keys)\n`);
  console.log("Next steps:");
  console.log("  1. Fund the deployer wallet with Sepolia ETH");
  console.log("  2. Run: DEPLOYER_KEY=0x... SEPOLIA_RPC=https://... npx tsx scripts/register-agents.ts\n");
}

main();

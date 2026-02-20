/**
 * Update ERC-8004 metadata for already-registered Sepolia agents.
 *
 * For each agent from scripts/sepolia-agents.json:
 * 1) setAgentURI(agentId, data:application/json;base64,<registration-file>)
 *    - registration file follows EIP-8004 registration-v1 shape.
 * 2) optional custom setMetadata keys from scripts/agent-profile.ts
 *
 * Notes:
 * - Reserved key "agentWallet" is NOT set via setMetadata (per spec).
 * - Metadata/profile schema is imported from scripts/agent-profile.ts
 *
 * Usage:
 *   DEPLOYER_KEY=0x... SEPOLIA_RPC=https://... npx tsx scripts/update-agent-metadata.ts
 */

import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAgentDataUri,
  buildOnchainMetadataEntries,
  type AgentProfileContext,
  type AgentProfileInput,
} from "./agent-profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_PATH = resolve(__dirname, "sepolia-agents.json");

const IdentityRegistryABI = [
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function setAgentURI(uint256 agentId, string newURI) external",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external",
  "function getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)",
  "function getAgentWallet(uint256 agentId) external view returns (address)",
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

function loadConfig(): SepoliaAgentsConfig {
  try {
    return JSON.parse(readFileSync(AGENTS_PATH, "utf-8"));
  } catch {
    console.error(`Could not read ${AGENTS_PATH}`);
    console.error("Run 'yarn sepolia:wallets' and 'yarn sepolia:register' first.");
    process.exit(1);
  }
}

async function main() {
  const deployerKey = process.env.DEPLOYER_KEY;
  const rpcUrl = process.env.SEPOLIA_RPC;

  if (!deployerKey) {
    console.error("Missing DEPLOYER_KEY env var");
    process.exit(1);
  }
  if (!rpcUrl) {
    console.error("Missing SEPOLIA_RPC env var");
    process.exit(1);
  }

  const config = loadConfig();

  const missingIds = config.agents.filter((a) => a.agentId === null);
  if (missingIds.length > 0) {
    console.error("Some agents are missing agentId. Run 'yarn sepolia:register' first.");
    for (const a of missingIds) {
      console.error(`- ${a.name} (${a.address})`);
    }
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const deployer = new ethers.Wallet(deployerKey, provider);
  const deployerAddress = await deployer.getAddress();

  console.log("\nUpdating ERC-8004 metadata on Sepolia\n");
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`Identity Registry: ${config.identityRegistry}\n`);

  if (Number(network.chainId) !== config.chainId) {
    console.error(
      `Chain mismatch: config chainId=${config.chainId}, rpc chainId=${network.chainId}`,
    );
    process.exit(1);
  }

  const identity = new ethers.Contract(
    config.identityRegistry,
    IdentityRegistryABI,
    deployer,
  );

  const abi = ethers.AbiCoder.defaultAbiCoder();
  const profileContext: AgentProfileContext = {
    chainId: network.chainId,
    identityRegistry: config.identityRegistry,
  };

  for (const agent of config.agents) {
    const agentId = agent.agentId as number;
    console.log(`--- ${agent.name} (agentId=${agentId}) ---`);
    const profileAgent: AgentProfileInput = {
      name: agent.name,
      address: agent.address,
      agentId,
    };

    const owner = await identity.ownerOf(agentId);
    if (owner.toLowerCase() !== deployerAddress.toLowerCase()) {
      console.error(
        `Owner mismatch for agentId ${agentId}: expected ${deployerAddress}, got ${owner}`,
      );
      process.exit(1);
    }

    const dataUri = buildAgentDataUri(profileAgent, profileContext);

    const setUriTx = await identity.setAgentURI(agentId, dataUri);
    await setUriTx.wait();
    console.log("setAgentURI: ok");

    const metadataEntries = buildOnchainMetadataEntries(
      profileAgent,
      profileContext,
      deployerAddress,
    );
    if (metadataEntries.length === 0) {
      console.log("No custom metadata keys configured (standards-only profile).");
    } else {
      for (const entry of metadataEntries) {
        const setMetadataTx = await identity.setMetadata(
          agentId,
          entry.key,
          abi.encode([entry.abiType], [entry.value]),
        );
        await setMetadataTx.wait();
        console.log(`setMetadata(${entry.key}): ok`);
      }

      for (const entry of metadataEntries) {
        const storedValue = abi.decode(
          [entry.abiType],
          await identity.getMetadata(agentId, entry.key),
        )[0];
        console.log(`verify ${entry.key}: ${storedValue}`);
      }
    }

    const agentWallet = await identity.getAgentWallet(agentId);
    const uri = await identity.tokenURI(agentId);

    console.log(`verify agentWallet: ${agentWallet}`);
    console.log(`verify tokenURI prefix: ${uri.slice(0, 32)}...`);
    console.log();
  }

  console.log("Metadata update complete.\n");
}

main().catch((err) => {
  console.error("Metadata update failed:", err);
  process.exit(1);
});

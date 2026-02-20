/**
 * Update ERC-8004 metadata for already-registered Sepolia agents.
 *
 * For each agent from scripts/sepolia-agents.json:
 * 1) setAgentURI(agentId, data:application/json;base64,<registration-file>)
 *    - registration file follows EIP-8004 registration-v1 shape.
 * 2) setMetadata(agentId, "workerAddress", abi.encode(address))
 * 3) setMetadata(agentId, "ownerAddress", abi.encode(address)) // deployer
 * 4) setMetadata(agentId, "agentRegistry", abi.encode(string))
 * 5) setMetadata(agentId, "profileVersion", abi.encode(string))
 *
 * Notes:
 * - Reserved key "agentWallet" is NOT set via setMetadata (per spec).
 * - The deployer is used as ownerAddress metadata value.
 *
 * Usage:
 *   DEPLOYER_KEY=0x... SEPOLIA_RPC=https://... npx tsx scripts/update-agent-metadata.ts
 */

import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function svgDataUri(label: string): string {
  const escaped = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="100%" height="100%" fill="#0f172a"/><text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="#f8fafc" font-size="42" font-family="Arial">CREsolver</text><text x="50%" y="62%" dominant-baseline="middle" text-anchor="middle" fill="#cbd5e1" font-size="28" font-family="Arial">${escaped}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function buildRegistrationFile(
  agent: AgentEntry,
  chainId: bigint,
  identityRegistry: string,
): Record<string, unknown> {
  const agentRegistry = `eip155:${chainId}:${identityRegistry}`;
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `CREsolver ${agent.name}`,
    description:
      `CREsolver worker agent ${agent.name} for decentralized prediction market resolution.`,
    image: svgDataUri(agent.name),
    services: [
      {
        name: "wallet",
        endpoint: `eip155:${chainId}:${agent.address}`,
      },
      {
        name: "repository",
        endpoint: "https://github.com/gilbertsahumada/chaoschain/tree/main/cresolver",
      },
    ],
    x402Support: false,
    active: true,
    registrations: [
      {
        agentId: agent.agentId,
        agentRegistry,
      },
    ],
    supportedTrust: ["reputation"],
  };
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
  const agentRegistry = `eip155:${network.chainId}:${config.identityRegistry}`;

  for (const agent of config.agents) {
    const agentId = agent.agentId as number;
    console.log(`--- ${agent.name} (agentId=${agentId}) ---`);

    const owner = await identity.ownerOf(agentId);
    if (owner.toLowerCase() !== deployerAddress.toLowerCase()) {
      console.error(
        `Owner mismatch for agentId ${agentId}: expected ${deployerAddress}, got ${owner}`,
      );
      process.exit(1);
    }

    const registration = buildRegistrationFile(agent, network.chainId, config.identityRegistry);
    const registrationJson = JSON.stringify(registration);
    const dataUri = `data:application/json;base64,${Buffer.from(registrationJson).toString("base64")}`;

    const setUriTx = await identity.setAgentURI(agentId, dataUri);
    await setUriTx.wait();
    console.log("setAgentURI: ok");

    const setWorkerTx = await identity.setMetadata(
      agentId,
      "workerAddress",
      abi.encode(["address"], [agent.address]),
    );
    await setWorkerTx.wait();
    console.log("setMetadata(workerAddress): ok");

    const setOwnerTx = await identity.setMetadata(
      agentId,
      "ownerAddress",
      abi.encode(["address"], [deployerAddress]),
    );
    await setOwnerTx.wait();
    console.log("setMetadata(ownerAddress): ok");

    const setRegistryTx = await identity.setMetadata(
      agentId,
      "agentRegistry",
      abi.encode(["string"], [agentRegistry]),
    );
    await setRegistryTx.wait();
    console.log("setMetadata(agentRegistry): ok");

    const setProfileVersionTx = await identity.setMetadata(
      agentId,
      "profileVersion",
      abi.encode(["string"], ["registration-v1"]),
    );
    await setProfileVersionTx.wait();
    console.log("setMetadata(profileVersion): ok");

    const storedWorker = abi.decode(
      ["address"],
      await identity.getMetadata(agentId, "workerAddress"),
    )[0];
    const storedOwner = abi.decode(
      ["address"],
      await identity.getMetadata(agentId, "ownerAddress"),
    )[0];
    const storedRegistry = abi.decode(
      ["string"],
      await identity.getMetadata(agentId, "agentRegistry"),
    )[0];
    const agentWallet = await identity.getAgentWallet(agentId);
    const uri = await identity.tokenURI(agentId);

    console.log(`verify workerAddress: ${storedWorker}`);
    console.log(`verify ownerAddress: ${storedOwner}`);
    console.log(`verify agentRegistry: ${storedRegistry}`);
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

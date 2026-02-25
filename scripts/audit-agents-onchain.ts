/**
 * Strict on-chain audit for ERC-8004 agents.
 *
 * This script validates that every configured agent is aligned on Sepolia:
 * - privateKey -> address consistency
 * - agentId exists
 * - ownerOf(agentId) matches expected owner (optional but recommended)
 * - isAuthorizedOrOwner(worker, agentId) == true
 * - getAgentWallet(agentId) == worker address
 * - tokenURI is data:application/json;base64,...
 * - decoded registration-v1 JSON matches the current local template
 * - optional custom metadata keys (from agent-profile.ts) match expected values
 * - optional worker minimum balance
 *
 * Usage:
 *   DEPLOYER_KEY=0x... SEPOLIA_RPC=https://... npx tsx scripts/audit-agents-onchain.ts
 *   npx tsx scripts/audit-agents-onchain.ts --expected-owner 0x... --min-eth 0.01
 */

import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAgentDataUri,
  buildOnchainMetadataEntries,
  type AgentProfileContext,
  type AgentProfileInput,
} from "./agent-profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_PATH = resolve(__dirname, "sepolia-agents.json");

interface AgentEntry {
  name: string;
  address: string;
  privateKey: string;
  agentId: number | null;
  endpoint?: string;
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
  expectedOwner?: string;
  minEth: string;
  skipBalance: boolean;
}

const IdentityRegistryABI = [
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool)",
  "function getAgentWallet(uint256 agentId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)",
];

function parseArgs(argv: string[]): CliOptions {
  let rpcUrl = process.env.SEPOLIA_RPC;
  let expectedOwner = process.env.EXPECTED_OWNER;
  let minEth = "0";
  let skipBalance = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rpc-url") {
      rpcUrl = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--expected-owner") {
      expectedOwner = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--min-eth") {
      minEth = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--skip-balance") {
      skipBalance = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { rpcUrl, expectedOwner, minEth, skipBalance };
}

function loadConfig(): SepoliaAgentsConfig {
  try {
    return JSON.parse(readFileSync(AGENTS_PATH, "utf-8"));
  } catch {
    console.error(`Could not read ${AGENTS_PATH}`);
    console.error("Run 'yarn sepolia:wallets' first.");
    process.exit(1);
  }
}

function decodeRegistrationFromDataUri(uri: string): Record<string, unknown> | null {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) {
    return null;
  }
  try {
    const encoded = uri.slice(prefix.length);
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`);
  return `{${pairs.join(",")}}`;
}

function isEqualAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.rpcUrl) {
    throw new Error("Missing SEPOLIA_RPC env var or --rpc-url");
  }

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(opts.rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error(
      `Chain mismatch: config chainId=${config.chainId}, rpc chainId=${network.chainId}`,
    );
  }

  const identity = new ethers.Contract(config.identityRegistry, IdentityRegistryABI, provider);
  const code = await provider.getCode(config.identityRegistry);
  if (code === "0x") {
    throw new Error(`Identity registry has no code at ${config.identityRegistry}`);
  }

  let expectedOwner = opts.expectedOwner;
  if (!expectedOwner && process.env.DEPLOYER_KEY) {
    expectedOwner = new ethers.Wallet(process.env.DEPLOYER_KEY).address;
  }

  const minWei = ethers.parseEther(opts.minEth);
  const profileContext: AgentProfileContext = {
    chainId: network.chainId,
    identityRegistry: config.identityRegistry,
  };
  const abi = ethers.AbiCoder.defaultAbiCoder();

  console.log("\nERC-8004 On-Chain Audit\n");
  console.log(`Network: ${config.network} (${config.chainId})`);
  console.log(`Identity: ${config.identityRegistry}`);
  if (expectedOwner) {
    console.log(`Expected owner: ${expectedOwner}`);
  } else {
    console.log("Expected owner: not configured (owner check disabled)");
  }
  if (opts.skipBalance) {
    console.log("Balance check: disabled");
  } else {
    console.log(`Min worker balance: ${opts.minEth} ETH`);
  }
  console.log();

  let failures = 0;

  for (const agent of config.agents) {
    console.log(`--- ${agent.name} ---`);

    const walletFromKey = new ethers.Wallet(agent.privateKey).address;
    const keyMatches = isEqualAddress(walletFromKey, agent.address);
    if (!keyMatches) {
      failures++;
      console.log(`key->address: ERROR (${walletFromKey} != ${agent.address})`);
      console.log();
      continue;
    }
    console.log("key->address: OK");

    if (agent.agentId === null) {
      failures++;
      console.log("agentId: ERROR (null)");
      console.log();
      continue;
    }
    const agentId = agent.agentId;
    console.log(`agentId: ${agentId}`);

    let owner: string;
    try {
      owner = await identity.ownerOf(agentId);
      console.log(`ownerOf: ${owner}`);
    } catch (error) {
      failures++;
      console.log(`ownerOf: ERROR (${String(error)})`);
      console.log();
      continue;
    }

    if (expectedOwner && !isEqualAddress(owner, expectedOwner)) {
      failures++;
      console.log(`owner check: ERROR (expected ${expectedOwner})`);
    } else {
      console.log("owner check: OK");
    }

    const isAuthorized = await identity.isAuthorizedOrOwner(agent.address, agentId);
    if (!isAuthorized) {
      failures++;
      console.log("isAuthorizedOrOwner: ERROR");
    } else {
      console.log("isAuthorizedOrOwner: OK");
    }

    const agentWallet = await identity.getAgentWallet(agentId);
    if (!isEqualAddress(agentWallet, agent.address)) {
      failures++;
      console.log(`agentWallet: ERROR (${agentWallet} != ${agent.address})`);
    } else {
      console.log("agentWallet: OK");
    }

    const tokenUri = await identity.tokenURI(agentId);
    const registration = decodeRegistrationFromDataUri(tokenUri);
    if (!registration) {
      failures++;
      console.log("tokenURI decode: ERROR (not valid data:application/json;base64 URI)");
    } else {
      console.log("tokenURI decode: OK");

      const profileAgent: AgentProfileInput = {
        name: agent.name,
        address: agent.address,
        agentId,
        endpoint: agent.endpoint,
      };
      const expectedDataUri = buildAgentDataUri(profileAgent, profileContext);
      const expectedRegistration = decodeRegistrationFromDataUri(expectedDataUri);
      if (!expectedRegistration) {
        throw new Error("Internal error: expected registration could not be decoded");
      }

      const registrationMatchesTemplate =
        stableStringify(registration) === stableStringify(expectedRegistration);
      if (!registrationMatchesTemplate) {
        failures++;
        console.log("registration-v1 template: ERROR (on-chain tokenURI drift)");
      } else {
        console.log("registration-v1 template: OK");
      }

      // Check A2A endpoint in on-chain registration
      const services = registration.services;
      if (Array.isArray(services)) {
        const a2aService = services.find(
          (s) => s && typeof s === "object" && (s as { name?: unknown }).name === "A2A",
        ) as { endpoint?: string } | undefined;
        if (a2aService?.endpoint) {
          console.log(`A2A endpoint: ${a2aService.endpoint}`);
        } else {
          console.log("A2A endpoint: NOT CONFIGURED");
        }
      } else {
        console.log("A2A endpoint: NOT CONFIGURED (no services)");
      }
    }

    const metadataEntries = buildOnchainMetadataEntries(
      {
        name: agent.name,
        address: agent.address,
        agentId,
      },
      profileContext,
      expectedOwner ?? owner,
    );

    if (metadataEntries.length === 0) {
      console.log("custom metadata keys: SKIPPED (none configured)");
    } else {
      for (const entry of metadataEntries) {
        const raw = await identity.getMetadata(agentId, entry.key);
        const decoded = abi.decode([entry.abiType], raw)[0];
        if (String(decoded) !== String(entry.value)) {
          failures++;
          console.log(`metadata ${entry.key}: ERROR (${decoded} != ${entry.value})`);
        } else {
          console.log(`metadata ${entry.key}: OK`);
        }
      }
    }

    if (!opts.skipBalance) {
      const balance = await provider.getBalance(agent.address);
      if (balance < minWei) {
        failures++;
        console.log(
          `balance: ERROR (${ethers.formatEther(balance)} ETH < ${opts.minEth} ETH)`,
        );
      } else {
        console.log(`balance: OK (${ethers.formatEther(balance)} ETH)`);
      }
    }

    console.log();
  }

  if (failures > 0) {
    console.error(`Audit finished with ${failures} error(s).`);
    process.exit(1);
  }

  console.log("Audit passed: all configured agents are aligned on-chain.\n");
}

main().catch((error) => {
  console.error("Audit failed:", error);
  process.exit(1);
});

/**
 * Canonical Sepolia agent sync script for ERC-8004.
 *
 * This script is intentionally verbose and step-by-step because it is meant to
 * be operational runbook code for demos, judges, and hackathon setup.
 *
 * Modes:
 * - full:
 *   1) register missing agents (if agentId is null)
 *   2) set registration-v1 agentURI
 *   3) set verified agentWallet via EIP-712 + setAgentWallet
 *   4) approve worker wallet on ERC-721 agent NFT
 *   5) apply optional custom metadata keys (none by default)
 *   6) optionally top-up worker wallet ETH
 *   7) verify final state and write public artifacts
 *
 * - normalize:
 *   Same as above EXCEPT registration/funding. Used for already deployed agents.
 *
 * Usage examples:
 *   DEPLOYER_KEY=0x... SEPOLIA_RPC=https://... npx tsx scripts/sync-agents.ts --mode full
 *   DEPLOYER_KEY=0x... SEPOLIA_RPC=https://... npx tsx scripts/sync-agents.ts --mode normalize
 *
 * Optional flags:
 *   --fund-amount 0.05   Target minimum ETH per worker (only used when > 0)
 *   --no-fund            Disable funding even if fund amount is set
 */

import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildAgentDataUri,
  buildOnchainMetadataEntries,
  type AgentProfileContext,
  type AgentProfileInput,
} from "./agent-profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_PATH = resolve(__dirname, "sepolia-agents.json");
const PUBLIC_AGENTS_PATH = resolve(__dirname, "sepolia-agents.public.json");
const PUBLIC_DOCS_PATH = resolve(__dirname, "../contracts/SEPOLIA_AGENTS.md");

type SyncMode = "full" | "normalize";

interface CliOptions {
  mode: SyncMode;
  fundAmount: string;
  noFund: boolean;
}

interface AgentEntry {
  name: string;
  address: string;
  privateKey: string;
  agentId: number | null;
  /** HTTP endpoint for the A2A API (stored on-chain in tokenURI registration) */
  endpoint?: string;
}

interface SepoliaAgentsConfig {
  network: string;
  chainId: number;
  identityRegistry: string;
  reputationRegistry: string;
  agents: AgentEntry[];
}

interface Eip712DomainConfig {
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: string;
}

const IdentityRegistryABI = [
  "function register(string agentURI) external returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI) external",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature) external",
  "function getAgentWallet(uint256 agentId) external view returns (address)",
  "function approve(address to, uint256 tokenId) external",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external",
  "function getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)",
  "function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function eip712Domain() external view returns (bytes1, string, string, uint256, address, bytes32, uint256[])",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const AGENT_WALLET_SET_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  AgentWalletSet: [
    { name: "agentId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
};

function parseArgs(argv: string[]): CliOptions {
  let mode: SyncMode = "full";
  let fundAmountInput: string | null = null;
  let noFund = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode") {
      const value = argv[i + 1];
      if (value !== "full" && value !== "normalize") {
        throw new Error(`Invalid --mode '${value}'. Use 'full' or 'normalize'.`);
      }
      mode = value;
      i++;
      continue;
    }
    if (arg === "--fund-amount") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --fund-amount");
      }
      fundAmountInput = value;
      i++;
      continue;
    }
    if (arg === "--no-fund") {
      noFund = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const defaultFundAmount = mode === "full" ? "0.05" : "0";
  const fundAmount = fundAmountInput ?? process.env.FUND_AMOUNT ?? defaultFundAmount;

  return { mode, fundAmount, noFund };
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

function writePublicArtifacts(config: SepoliaAgentsConfig, deployerAddress: string): void {
  const generatedAt = new Date().toISOString();
  const publicView = {
    network: config.network,
    chainId: config.chainId,
    identityRegistry: config.identityRegistry,
    reputationRegistry: config.reputationRegistry,
    deployer: deployerAddress,
    generatedAt,
    agents: config.agents.map((agent) => ({
      name: agent.name,
      address: agent.address,
      agentId: agent.agentId,
    })),
  };

  writeFileSync(PUBLIC_AGENTS_PATH, JSON.stringify(publicView, null, 2));

  const rows = config.agents
    .map((agent) => `| ${agent.name} | \`${agent.address}\` | \`${agent.agentId ?? "null"}\` |`)
    .join("\n");

  const markdown = `# Sepolia Agents (Public)

Last updated: ${generatedAt}

## Registry Config

- Network: ${config.network}
- Chain ID: ${config.chainId}
- Identity Registry: \`${config.identityRegistry}\`
- Reputation Registry: \`${config.reputationRegistry}\`
- Deployer: \`${deployerAddress}\`

## Agents

| Name | Worker Address | Agent ID |
|---|---|---:|
${rows}

## Source

- Machine-readable file: \`scripts/sepolia-agents.public.json\`
- Private keys remain only in \`scripts/sepolia-agents.json\` (gitignored)
`;

  writeFileSync(PUBLIC_DOCS_PATH, markdown);
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

function walletEndpoint(chainId: bigint, workerAddress: string): string {
  return `eip155:${chainId}:${workerAddress}`;
}

function registrationContainsWalletService(
  registration: Record<string, unknown>,
  expectedEndpoint: string,
): boolean {
  const services = registration.services;
  if (!Array.isArray(services)) {
    return false;
  }

  return services.some((service) => {
    if (!service || typeof service !== "object") {
      return false;
    }
    const svc = service as { name?: unknown; endpoint?: unknown };
    return svc.name === "wallet" && svc.endpoint === expectedEndpoint;
  });
}

function parseAgentIdFromReceipt(identity: ethers.Contract, logs: readonly ethers.Log[]): number {
  const decodedLogs = logs
    .map((log) => {
      try {
        return identity.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ethers.LogDescription => entry !== null);

  const registered = decodedLogs.find((entry) => entry.name === "Registered");
  if (registered) {
    return Number(registered.args.agentId);
  }

  const transfer = decodedLogs.find((entry) => entry.name === "Transfer");
  if (transfer) {
    return Number(transfer.args.tokenId);
  }

  throw new Error("Unable to parse agentId from register transaction receipt logs.");
}

async function resolveEip712Domain(
  identity: ethers.Contract,
  chainId: bigint,
): Promise<Eip712DomainConfig> {
  const domain: Eip712DomainConfig = {
    name: "ERC8004IdentityRegistry",
    version: "1",
    chainId,
    verifyingContract: await identity.getAddress(),
  };

  try {
    const result = await identity.eip712Domain();
    const onchainName = String(result[1] ?? "");
    const onchainVersion = String(result[2] ?? "");
    if (onchainName.length > 0) {
      domain.name = onchainName;
    }
    if (onchainVersion.length > 0) {
      domain.version = onchainVersion;
    }
  } catch {
    // Keep defaults. Some proxies or ABI versions may not expose eip712Domain().
  }

  return domain;
}

async function signSetAgentWallet(
  workerPrivateKey: string,
  domain: Eip712DomainConfig,
  agentId: number,
  newWallet: string,
  owner: string,
  deadline: bigint,
): Promise<string> {
  const workerSigner = new ethers.Wallet(workerPrivateKey);
  return workerSigner.signTypedData(
    {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
    },
    AGENT_WALLET_SET_TYPES,
    {
      agentId: BigInt(agentId),
      newWallet,
      owner,
      deadline,
    },
  );
}

export async function runAgentSync(argv: string[]): Promise<void> {
  const options = parseArgs(argv);

  const deployerKey = process.env.DEPLOYER_KEY;
  const rpcUrl = process.env.SEPOLIA_RPC;
  if (!deployerKey) {
    throw new Error("Missing DEPLOYER_KEY env var");
  }
  if (!rpcUrl) {
    throw new Error("Missing SEPOLIA_RPC env var");
  }

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error(
      `Chain mismatch: config chainId=${config.chainId}, rpc chainId=${network.chainId}`,
    );
  }

  const deployer = new ethers.Wallet(deployerKey, provider);
  const deployerAddress = await deployer.getAddress();
  const identity = new ethers.Contract(config.identityRegistry, IdentityRegistryABI, deployer);
  const abi = ethers.AbiCoder.defaultAbiCoder();

  const profileContext: AgentProfileContext = {
    chainId: network.chainId,
    identityRegistry: config.identityRegistry,
  };
  const domain = await resolveEip712Domain(identity, network.chainId);
  const targetFundingWei = ethers.parseEther(options.fundAmount);
  const shouldFund = !options.noFund && targetFundingWei > 0n;

  console.log("\nSyncing ERC-8004 agents on Sepolia\n");
  console.log(`Mode: ${options.mode}`);
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Identity Registry: ${config.identityRegistry}`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`Funding enabled: ${shouldFund ? "yes" : "no"}`);
  if (shouldFund) {
    console.log(`Funding target per worker: ${options.fundAmount} ETH`);
  }
  console.log(`EIP-712 domain: ${domain.name} v${domain.version}\n`);

  // Step 0: In normalize mode, agent IDs must already exist.
  if (options.mode === "normalize") {
    const missingAgentIds = config.agents.filter((agent) => agent.agentId === null);
    if (missingAgentIds.length > 0) {
      const list = missingAgentIds.map((agent) => `${agent.name} (${agent.address})`).join(", ");
      throw new Error(
        `Normalize mode requires pre-registered agents. Missing agentId for: ${list}`,
      );
    }
  }

  let hasErrors = false;

  for (const agent of config.agents) {
    console.log(`--- ${agent.name} ---`);
    console.log(`Worker wallet: ${agent.address}`);

    // Step 1: Register missing agent (full mode only).
    if (agent.agentId === null) {
      if (options.mode !== "full") {
        throw new Error(`Agent ${agent.name} has no agentId in normalize mode.`);
      }

      console.log("Step 1/7 - Registering agent...");
      const placeholderUri = `CREsolver Agent ${agent.name}`;
      const registerTx = await identity.register(placeholderUri);
      const registerReceipt = await registerTx.wait();
      agent.agentId = parseAgentIdFromReceipt(identity, registerReceipt.logs);
      console.log(`Registered: agentId = ${agent.agentId}`);
    } else {
      console.log(`Step 1/7 - Agent already registered (agentId=${agent.agentId}), skipping register.`);
    }

    const agentId = agent.agentId;
    const profileAgent: AgentProfileInput = {
      name: agent.name,
      address: agent.address,
      agentId,
      endpoint: agent.endpoint,
    };

    // Step 2: Ensure agentURI follows registration-v1 profile.
    console.log("Step 2/7 - Setting registration-v1 agentURI...");
    const dataUri = buildAgentDataUri(profileAgent, profileContext);
    const setUriTx = await identity.setAgentURI(agentId, dataUri);
    await setUriTx.wait();
    console.log("setAgentURI: ok");

    // Step 3: Ensure setAgentWallet is aligned with worker wallet via EIP-712 signature.
    console.log("Step 3/7 - Aligning agentWallet via EIP-712 + setAgentWallet...");
    const currentAgentWallet = await identity.getAgentWallet(agentId);
    if (currentAgentWallet.toLowerCase() === agent.address.toLowerCase()) {
      console.log(`agentWallet already aligned: ${currentAgentWallet}`);
    } else {
      const latestBlock = await provider.getBlock("latest");
      const blockTs = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));
      // Contract enforces deadline <= block.timestamp + 5 minutes.
      const deadline = blockTs + 240n;
      const signature = await signSetAgentWallet(
        agent.privateKey,
        domain,
        agentId,
        agent.address,
        deployerAddress,
        deadline,
      );
      const setWalletTx = await identity.setAgentWallet(agentId, agent.address, deadline, signature);
      await setWalletTx.wait();
      console.log("setAgentWallet: ok");
    }

    // Step 4: Ensure worker wallet is approved in ERC-721 so join flow passes isAuthorizedOrOwner.
    console.log("Step 4/7 - Ensuring worker approval...");
    const isAuthorizedBefore = await identity.isAuthorizedOrOwner(agent.address, agentId);
    if (isAuthorizedBefore) {
      console.log("approval already valid");
    } else {
      const approveTx = await identity.approve(agent.address, agentId);
      await approveTx.wait();
      console.log("approve: ok");
    }

    // Step 5: Optional custom metadata keys (default: none, standards-only profile).
    console.log("Step 5/7 - Applying optional custom metadata keys...");
    const metadataEntries = buildOnchainMetadataEntries(
      profileAgent,
      profileContext,
      deployerAddress,
    );
    if (metadataEntries.length === 0) {
      console.log("no custom metadata keys configured");
    } else {
      for (const entry of metadataEntries) {
        const setMetadataTx = await identity.setMetadata(
          agentId,
          entry.key,
          abi.encode([entry.abiType], [entry.value]),
        );
        await setMetadataTx.wait();
        const stored = abi.decode([entry.abiType], await identity.getMetadata(agentId, entry.key))[0];
        console.log(`setMetadata(${entry.key}): ${stored}`);
      }
    }

    // Step 6: Optional funding to target minimum ETH.
    console.log("Step 6/7 - Funding check...");
    if (!shouldFund) {
      console.log("funding disabled");
    } else {
      const workerBalance = await provider.getBalance(agent.address);
      if (workerBalance >= targetFundingWei) {
        console.log(`worker already funded (${ethers.formatEther(workerBalance)} ETH)`);
      } else {
        const topupWei = targetFundingWei - workerBalance;
        const fundTx = await deployer.sendTransaction({
          to: agent.address,
          value: topupWei,
        });
        await fundTx.wait();
        const newBalance = await provider.getBalance(agent.address);
        console.log(`funded +${ethers.formatEther(topupWei)} ETH -> ${ethers.formatEther(newBalance)} ETH`);
      }
    }

    // Step 7: Verification pass (owner, auth, agentWallet, tokenURI wallet service).
    console.log("Step 7/7 - Verifying final state...");
    const owner = await identity.ownerOf(agentId);
    const isAuthorized = await identity.isAuthorizedOrOwner(agent.address, agentId);
    const finalAgentWallet = await identity.getAgentWallet(agentId);
    const finalUri = await identity.tokenURI(agentId);
    const registration = decodeRegistrationFromDataUri(finalUri);
    const expectedEndpoint = walletEndpoint(network.chainId, agent.address);
    const hasWalletService =
      registration !== null && registrationContainsWalletService(registration, expectedEndpoint);

    if (owner.toLowerCase() !== deployerAddress.toLowerCase()) {
      console.error(`ERROR owner mismatch: expected ${deployerAddress}, got ${owner}`);
      hasErrors = true;
    }
    if (!isAuthorized) {
      console.error("ERROR isAuthorizedOrOwner=false for worker");
      hasErrors = true;
    }
    if (finalAgentWallet.toLowerCase() !== agent.address.toLowerCase()) {
      console.error(`ERROR agentWallet mismatch: expected ${agent.address}, got ${finalAgentWallet}`);
      hasErrors = true;
    }
    if (!hasWalletService) {
      console.error(`ERROR tokenURI wallet service missing expected endpoint ${expectedEndpoint}`);
      hasErrors = true;
    }

    console.log(`owner: ${owner}`);
    console.log(`isAuthorizedOrOwner: ${isAuthorized}`);
    console.log(`agentWallet: ${finalAgentWallet}`);
    console.log(`wallet service endpoint: ${hasWalletService ? "ok" : "missing"}`);
    console.log();
  }

  writeFileSync(AGENTS_PATH, JSON.stringify(config, null, 2));
  writePublicArtifacts(config, deployerAddress);

  console.log(`Config updated: ${AGENTS_PATH}`);
  console.log(`Public file: ${PUBLIC_AGENTS_PATH}`);
  console.log(`Public docs: ${PUBLIC_DOCS_PATH}\n`);

  if (hasErrors) {
    throw new Error("Agent sync completed with verification errors.");
  }

  console.log("Agent sync completed successfully.\n");
}

async function main(): Promise<void> {
  await runAgentSync(process.argv.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Agent sync failed:", error);
    process.exit(1);
  });
}

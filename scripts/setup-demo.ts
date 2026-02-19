import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Profile = "local" | "e2e";

interface SetupOptions {
  profile: Profile;
  rpcUrl: string;
  agentPorts: number[];
  outputPath: string;
  waitForServices: boolean;
  deployReceiver: boolean;
  requestResolutions: boolean;
}

interface DemoMarket {
  question: string;
  rewardEth: string;
  durationSeconds: number;
}

interface WorkerConfig {
  name: string;
  address: string;
  privateKey: string;
  port: number;
}

const AGENT_NAMES = ["Alpha", "Beta", "Gamma"];

const DEMO_MARKETS: DemoMarket[] = [
  {
    question: "Will bitcoin reach 200k by end of 2026?",
    rewardEth: "0.1",
    durationSeconds: 3600,
  },
  {
    question: "Has ethereum successfully transitioned to pos consensus?",
    rewardEth: "0.05",
    durationSeconds: 3600,
  },
  {
    question: "Will a spot bitcoin etf be approved in 2024?",
    rewardEth: "0.08",
    durationSeconds: 3600,
  },
];

function parseNumberList(value: string): number[] {
  return value
    .split(",")
    .map((v) => parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v));
}

function parseArgs(argv: string[]): SetupOptions {
  let profile: Profile = "local";
  let customOutput: string | undefined;
  let customRpcUrl: string | undefined;
  let customAgentPorts: number[] | undefined;
  let waitForServices: boolean | undefined;
  let deployReceiver: boolean | undefined;
  let requestResolutions: boolean | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") {
      const value = argv[i + 1];
      if (value === "local" || value === "e2e") {
        profile = value;
      } else {
        throw new Error(`Invalid profile "${value}". Use "local" or "e2e".`);
      }
      i++;
      continue;
    }
    if (arg === "--output") {
      customOutput = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--rpc-url") {
      customRpcUrl = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--agent-ports") {
      customAgentPorts = parseNumberList(argv[i + 1]);
      i++;
      continue;
    }
    if (arg === "--wait") {
      waitForServices = true;
      continue;
    }
    if (arg === "--no-wait") {
      waitForServices = false;
      continue;
    }
    if (arg === "--receiver") {
      deployReceiver = true;
      continue;
    }
    if (arg === "--no-receiver") {
      deployReceiver = false;
      continue;
    }
    if (arg === "--request") {
      requestResolutions = true;
      continue;
    }
    if (arg === "--no-request") {
      requestResolutions = false;
      continue;
    }
  }

  const profileDefaults =
    profile === "e2e"
      ? {
          rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8547",
          agentPorts: [3101, 3102, 3103],
          outputPath: "../e2e/demo-config.json",
          waitForServices: true,
          deployReceiver: true,
          requestResolutions: true,
        }
      : {
          rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
          agentPorts: [3001, 3002, 3003],
          outputPath: "demo-config.json",
          waitForServices: false,
          deployReceiver: false,
          requestResolutions: false,
        };

  const finalAgentPorts = customAgentPorts ?? profileDefaults.agentPorts;
  if (finalAgentPorts.length !== AGENT_NAMES.length) {
    throw new Error(
      `Expected ${AGENT_NAMES.length} agent ports, got ${finalAgentPorts.length}.`,
    );
  }

  return {
    profile,
    rpcUrl: customRpcUrl ?? profileDefaults.rpcUrl,
    agentPorts: finalAgentPorts,
    outputPath: resolve(__dirname, customOutput ?? profileDefaults.outputPath),
    waitForServices: waitForServices ?? profileDefaults.waitForServices,
    deployReceiver: deployReceiver ?? profileDefaults.deployReceiver,
    requestResolutions: requestResolutions ?? profileDefaults.requestResolutions,
  };
}

function makeWorkerWallets(count: number): ethers.HDNodeWallet[] {
  const mnemonic = ethers.Mnemonic.fromPhrase(
    "test test test test test test test test test test test junk",
  );
  const wallets: ethers.HDNodeWallet[] = [];
  for (let i = 0; i < count; i++) {
    wallets.push(
      ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i + 1}`),
    );
  }
  return wallets;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAnvil(
  rpcUrl: string,
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  while (Date.now() < deadline) {
    try {
      await provider.getBlockNumber();
      return;
    } catch {
      await sleep(intervalMs);
    }
  }
  throw new Error(`Anvil not ready at ${rpcUrl} after ${timeoutMs}ms`);
}

async function waitForAgent(
  baseUrl: string,
  name: string,
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // Keep polling until timeout.
    }
    await sleep(intervalMs);
  }
  throw new Error(`Agent ${name} not ready at ${baseUrl} after ${timeoutMs}ms`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const title =
    options.profile === "e2e" ? "CRE E2E Setup" : "CREsolver Demo Setup";

  console.log("╔══════════════════════════════════════════════════╗");
  console.log(`║       ${title.padEnd(41)}║`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log(`Profile: ${options.profile}`);
  console.log(`RPC: ${options.rpcUrl}`);
  console.log(`Agents: ${options.agentPorts.join(", ")}`);
  console.log(`Output: ${options.outputPath}\n`);

  if (options.waitForServices) {
    console.log("--- Waiting for Anvil ---");
    await waitForAnvil(options.rpcUrl);
    console.log("  Anvil is healthy\n");

    console.log("--- Waiting for agents ---");
    for (let i = 0; i < options.agentPorts.length; i++) {
      const url = `http://127.0.0.1:${options.agentPorts[i]}`;
      await waitForAgent(url, AGENT_NAMES[i]);
      console.log(`  ${AGENT_NAMES[i]} healthy at ${url}`);
    }
    console.log();
  }

  const provider = new ethers.JsonRpcProvider(options.rpcUrl);
  const blockNumber = await provider.getBlockNumber();
  console.log(`Connected to ${options.rpcUrl} (block #${blockNumber})\n`);

  const anvilMnemonic =
    "test test test test test test test test test test test junk";
  const rawDeployer = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(anvilMnemonic),
    "m/44'/60'/0'/0/0",
  ).connect(provider);
  const deployer = new ethers.NonceManager(rawDeployer);
  console.log(`Deployer: ${rawDeployer.address}`);

  console.log("\n--- Deploying CREsolverMarket ---");
  const marketArtifactPath = resolve(
    __dirname,
    "../contracts/out/CREsolverMarket.sol/CREsolverMarket.json",
  );
  const marketArtifact = JSON.parse(readFileSync(marketArtifactPath, "utf-8"));
  const marketFactory = new ethers.ContractFactory(
    marketArtifact.abi,
    marketArtifact.bytecode.object,
    deployer,
  );
  const deployedMarket = await marketFactory.deploy(
    ethers.ZeroAddress,
    ethers.ZeroAddress,
  );
  await deployedMarket.waitForDeployment();
  const contractAddress = await deployedMarket.getAddress();
  console.log(`  CREsolverMarket deployed at: ${contractAddress}`);

  const contract = new ethers.Contract(contractAddress, marketArtifact.abi, deployer);

  console.log("\n--- Authorizing resolvers ---");
  const authorizeDeployerTx = await contract.setAuthorizedResolver(
    rawDeployer.address,
    true,
  );
  await authorizeDeployerTx.wait();
  console.log("  Deployer authorized as resolver");

  let receiverAddress: string | null = null;
  let forwarderAddress: string | null = null;

  if (options.deployReceiver) {
    console.log("\n--- Deploying CREReceiver ---");
    const receiverArtifactPath = resolve(
      __dirname,
      "../contracts/out/CREReceiver.sol/CREReceiver.json",
    );
    const receiverArtifact = JSON.parse(
      readFileSync(receiverArtifactPath, "utf-8"),
    );
    const receiverFactory = new ethers.ContractFactory(
      receiverArtifact.abi,
      receiverArtifact.bytecode.object,
      deployer,
    );

    forwarderAddress = rawDeployer.address;
    const deployedReceiver = await receiverFactory.deploy(
      contractAddress,
      forwarderAddress,
    );
    await deployedReceiver.waitForDeployment();
    receiverAddress = await deployedReceiver.getAddress();
    console.log(`  CREReceiver deployed at: ${receiverAddress}`);

    const authorizeReceiverTx = await contract.setAuthorizedResolver(
      receiverAddress,
      true,
    );
    await authorizeReceiverTx.wait();
    console.log("  CREReceiver authorized as resolver");
  }

  console.log("\n--- Setting up workers ---");
  const workerWallets = makeWorkerWallets(options.agentPorts.length);
  const workerEndpoints = new Map<string, string>();
  const workers: WorkerConfig[] = [];

  for (let i = 0; i < workerWallets.length; i++) {
    const wallet = workerWallets[i].connect(provider);
    const endpoint = `http://127.0.0.1:${options.agentPorts[i]}`;

    const fundTx = await deployer.sendTransaction({
      to: wallet.address,
      value: ethers.parseEther("1.0"),
    });
    await fundTx.wait();

    workerEndpoints.set(wallet.address.toLowerCase(), endpoint);
    workers.push({
      name: AGENT_NAMES[i],
      address: wallet.address,
      privateKey: wallet.privateKey,
      port: options.agentPorts[i],
    });

    console.log(`  Worker ${AGENT_NAMES[i]}: ${wallet.address} → ${endpoint}`);
  }

  console.log("\n--- Creating markets ---");
  for (let m = 0; m < DEMO_MARKETS.length; m++) {
    const market = DEMO_MARKETS[m];
    const createTx = await contract.createMarket(
      market.question,
      market.durationSeconds,
      { value: ethers.parseEther(market.rewardEth) },
    );
    await createTx.wait();
    console.log(
      `  Market #${m}: "${market.question.slice(0, 50)}..." (${market.rewardEth} ETH)`,
    );

    for (let w = 0; w < workerWallets.length; w++) {
      const workerSigner = workerWallets[w].connect(provider);
      const workerContract = new ethers.Contract(
        contractAddress,
        marketArtifact.abi,
        workerSigner,
      );
      const joinTx = await workerContract.joinMarket(m, 0, {
        value: ethers.parseEther("0.01"),
      });
      await joinTx.wait();
    }
    console.log(`    ${workerWallets.length} workers joined`);
  }

  if (options.requestResolutions) {
    console.log("\n--- Requesting resolutions ---");
    for (let m = 0; m < DEMO_MARKETS.length; m++) {
      const reqTx = await contract.requestResolution(m);
      const receipt = await reqTx.wait();
      console.log(
        `  Market #${m}: ResolutionRequested emitted (tx: ${receipt.hash.slice(0, 18)}...)`,
      );
    }
  }

  const demoConfig = {
    profile: options.profile,
    rpcUrl: options.rpcUrl,
    contractAddress,
    receiverAddress,
    resolverPrivateKey: rawDeployer.privateKey,
    forwarderAddress,
    workerEndpoints: Object.fromEntries(workerEndpoints),
    workers,
    marketCount: DEMO_MARKETS.length,
    markets: DEMO_MARKETS,
  };

  writeFileSync(options.outputPath, JSON.stringify(demoConfig, null, 2));

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Setup complete!                                 ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  Config: ${options.outputPath}`);
  console.log(`  Market: ${contractAddress}`);
  if (receiverAddress) {
    console.log(`  Receiver: ${receiverAddress}`);
  }
  console.log(`  Markets: ${DEMO_MARKETS.length}`);
  console.log(`  Workers: ${workerWallets.length}\n`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});

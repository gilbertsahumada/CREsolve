import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForAnvil, waitForAgent } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8547";
const AGENT_PORTS = [3101, 3102, 3103];
const AGENT_NAMES = ["Alpha", "Beta", "Gamma"];

const DEMO_MARKETS = [
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

// ─── Deterministic worker wallets (from Anvil HD path) ───────────────────────

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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║       CRE E2E Setup                              ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // 1. Wait for Anvil
  console.log("--- Waiting for Anvil ---");
  await waitForAnvil(RPC_URL);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const blockNumber = await provider.getBlockNumber();
  console.log(`  Connected to ${RPC_URL} (block #${blockNumber})\n`);

  // 2. Wait for agents
  console.log("--- Waiting for agents ---");
  for (let i = 0; i < AGENT_PORTS.length; i++) {
    const url = `http://127.0.0.1:${AGENT_PORTS[i]}`;
    await waitForAgent(url, AGENT_NAMES[i]);
    console.log(`  ${AGENT_NAMES[i]} healthy at ${url}`);
  }
  console.log();

  // 3. Deploy CREsolverMarket
  console.log("--- Deploying CREsolverMarket ---");
  const anvilMnemonic =
    "test test test test test test test test test test test junk";
  const rawDeployer = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(anvilMnemonic),
    "m/44'/60'/0'/0/0",
  ).connect(provider);
  const deployer = new ethers.NonceManager(rawDeployer);
  console.log(`  Deployer: ${rawDeployer.address}`);

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
  const deployedMarket = await marketFactory.deploy();
  await deployedMarket.waitForDeployment();
  const contractAddress = await deployedMarket.getAddress();
  console.log(`  CREsolverMarket deployed at: ${contractAddress}`);

  const contract = new ethers.Contract(contractAddress, marketArtifact.abi, deployer);

  // 4. Deploy CREReceiver
  console.log("\n--- Deploying CREReceiver ---");
  const receiverArtifactPath = resolve(
    __dirname,
    "../contracts/out/CREReceiver.sol/CREReceiver.json",
  );
  const receiverArtifact = JSON.parse(readFileSync(receiverArtifactPath, "utf-8"));
  const receiverFactory = new ethers.ContractFactory(
    receiverArtifact.abi,
    receiverArtifact.bytecode.object,
    deployer,
  );
  // Use deployer as the forwarder for local testing
  const deployedReceiver = await receiverFactory.deploy(contractAddress, rawDeployer.address);
  await deployedReceiver.waitForDeployment();
  const receiverAddress = await deployedReceiver.getAddress();
  console.log(`  CREReceiver deployed at: ${receiverAddress}`);

  // 5. Authorize both deployer and receiver as resolvers
  const tx0 = await contract.setAuthorizedResolver(rawDeployer.address, true);
  await tx0.wait();
  console.log(`  Deployer authorized as resolver`);

  const tx1 = await contract.setAuthorizedResolver(receiverAddress, true);
  await tx1.wait();
  console.log(`  CREReceiver authorized as resolver`);

  // 6. Create worker wallets and fund them
  console.log("\n--- Setting up workers ---");
  const workerWallets = makeWorkerWallets(AGENT_PORTS.length);
  const workerEndpoints = new Map<string, string>();

  for (let i = 0; i < workerWallets.length; i++) {
    const wallet = workerWallets[i].connect(provider);
    const endpoint = `http://127.0.0.1:${AGENT_PORTS[i]}`;

    const fundTx = await deployer.sendTransaction({
      to: wallet.address,
      value: ethers.parseEther("1.0"),
    });
    await fundTx.wait();

    workerEndpoints.set(wallet.address.toLowerCase(), endpoint);
    console.log(
      `  Worker ${AGENT_NAMES[i]}: ${wallet.address} → ${endpoint}`,
    );
  }

  // 7. Create markets and have workers join
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
      const joinTx = await workerContract.joinMarket(m, {
        value: ethers.parseEther("0.01"),
      });
      await joinTx.wait();
    }
    console.log(`    ${workerWallets.length} workers joined`);
  }

  // 8. Request resolution for all markets (emits ResolutionRequested events)
  console.log("\n--- Requesting resolutions ---");
  for (let m = 0; m < DEMO_MARKETS.length; m++) {
    const reqTx = await contract.requestResolution(m);
    const receipt = await reqTx.wait();
    console.log(`  Market #${m}: ResolutionRequested event emitted (tx: ${receipt.hash.slice(0, 18)}...)`);
  }

  // 9. Write config for tests
  const demoConfig = {
    rpcUrl: RPC_URL,
    contractAddress,
    receiverAddress,
    resolverPrivateKey: rawDeployer.privateKey,
    forwarderAddress: rawDeployer.address,
    workerEndpoints: Object.fromEntries(workerEndpoints),
    workers: workerWallets.map((w, i) => ({
      name: AGENT_NAMES[i],
      address: w.address,
      privateKey: w.privateKey,
      port: AGENT_PORTS[i],
    })),
    marketCount: DEMO_MARKETS.length,
    markets: DEMO_MARKETS,
  };

  const configPath = resolve(__dirname, "demo-config.json");
  writeFileSync(configPath, JSON.stringify(demoConfig, null, 2));

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  E2E Setup complete!                             ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  Config: ${configPath}`);
  console.log(`  Market: ${contractAddress}`);
  console.log(`  Receiver: ${receiverAddress}`);
  console.log(`  Markets: ${DEMO_MARKETS.length}`);
  console.log(`  Workers: ${workerWallets.length}\n`);
}

main().catch((err) => {
  console.error("E2E setup failed:", err);
  process.exit(1);
});

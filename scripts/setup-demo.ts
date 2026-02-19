import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const AGENT_PORTS = [3001, 3002, 3003];
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
  // Use a fixed mnemonic-derived path so wallets are deterministic
  const mnemonic = ethers.Mnemonic.fromPhrase(
    "test test test test test test test test test test test junk",
  );
  const wallets: ethers.HDNodeWallet[] = [];
  for (let i = 0; i < count; i++) {
    // Start from index 1 to avoid collision with Anvil account[0]
    wallets.push(ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i + 1}`));
  }
  return wallets;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║       CREsolver Demo Setup                      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Connect to RPC
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const blockNumber = await provider.getBlockNumber();
  console.log(`Connected to ${RPC_URL} (block #${blockNumber})\n`);

  // Use Anvil account[0] as deployer, wrapped in NonceManager for sequential txs
  const anvilMnemonic = "test test test test test test test test test test test junk";
  const rawDeployer = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(anvilMnemonic),
    "m/44'/60'/0'/0/0",
  ).connect(provider);
  const deployer = new ethers.NonceManager(rawDeployer);
  console.log(`Deployer: ${rawDeployer.address}`);

  // Deploy CREsolverMarket
  console.log("\n--- Deploying CREsolverMarket ---");
  const artifactPath = resolve(
    __dirname,
    "../contracts/out/CREsolverMarket.sol/CREsolverMarket.json",
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode.object,
    deployer,
  );
  const deployedContract = await factory.deploy(ethers.ZeroAddress, ethers.ZeroAddress);
  await deployedContract.waitForDeployment();
  const contractAddress = await deployedContract.getAddress();
  console.log(`  Contract deployed at: ${contractAddress}`);

  // Create a fresh contract instance to avoid nonce caching issues
  const contract = new ethers.Contract(contractAddress, artifact.abi, deployer);

  // Authorize deployer as resolver
  const tx0 = await contract.setAuthorizedResolver(rawDeployer.address, true);
  await tx0.wait();
  console.log(`  Deployer authorized as resolver`);

  // Create worker wallets and fund them
  console.log("\n--- Setting up workers ---");
  const workerWallets = makeWorkerWallets(AGENT_PORTS.length);
  const workerEndpoints = new Map<string, string>();

  for (let i = 0; i < workerWallets.length; i++) {
    const wallet = workerWallets[i].connect(provider);
    const endpoint = `http://127.0.0.1:${AGENT_PORTS[i]}`;

    // Fund worker
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

  // Create markets and have workers join
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

    // Each worker joins each market
    for (let w = 0; w < workerWallets.length; w++) {
      const workerSigner = workerWallets[w].connect(provider);
      const workerContract = new ethers.Contract(
        contractAddress,
        artifact.abi,
        workerSigner,
      );
      const joinTx = await workerContract.joinMarket(m, 0, {
        value: ethers.parseEther("0.01"),
      });
      await joinTx.wait();
    }
    console.log(`    ${workerWallets.length} workers joined`);
  }

  // Save config for demo-run
  const demoConfig = {
    rpcUrl: RPC_URL,
    contractAddress,
    resolverPrivateKey: rawDeployer.privateKey,
    workerEndpoints: Object.fromEntries(workerEndpoints),
    workers: workerWallets.map((w, i) => ({
      name: AGENT_NAMES[i],
      address: w.address,
      privateKey: w.privateKey,
      port: AGENT_PORTS[i],
    })),
    marketCount: DEMO_MARKETS.length,
  };

  const configPath = resolve(__dirname, "demo-config.json");
  writeFileSync(configPath, JSON.stringify(demoConfig, null, 2));

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Setup complete!                                 ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\nConfig saved to: ${configPath}`);
  console.log(`Contract: ${contractAddress}`);
  console.log(`Markets: ${DEMO_MARKETS.length}`);
  console.log(`Workers: ${workerWallets.length}`);
  console.log(`\nNext: start agents and run 'yarn demo'`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});

import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runResolutionWorkflow } from "./workflow-runner.js";
import type { WorkflowConfig } from "./workflow-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Parse market ID from CLI args (default: 0)
  const marketId = parseInt(process.argv[2] || "0", 10);

  // Load config from setup
  const configPath = resolve(__dirname, "demo-config.json");
  let demoConfig: {
    rpcUrl: string;
    contractAddress: string;
    resolverPrivateKey: string;
    workerEndpoints: Record<string, string>;
    workers: { name: string; address: string; port: number }[];
    marketCount: number;
  };

  try {
    demoConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    console.error("demo-config.json not found. Run 'yarn setup' first.");
    process.exit(1);
  }

  if (marketId >= demoConfig.marketCount) {
    console.error(
      `Market #${marketId} does not exist. Available: 0-${demoConfig.marketCount - 1}`,
    );
    process.exit(1);
  }

  // Verify agents are running
  console.log("Checking agent health...");
  for (const worker of demoConfig.workers) {
    try {
      const res = await fetch(
        `http://127.0.0.1:${worker.port}/health`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log(
        `  ${worker.name} (${worker.address.slice(0, 10)}...): ${data.status} [${data.mode}]`,
      );
    } catch {
      console.error(
        `  ${worker.name} (port ${worker.port}): NOT RUNNING`,
      );
      console.error(
        `\nStart agents first:\n  cd ../agent && AGENT_PORT=${worker.port} AGENT_NAME="${worker.name}" yarn dev`,
      );
      process.exit(1);
    }
  }

  // Build workflow config
  const workflowConfig: WorkflowConfig = {
    rpcUrl: demoConfig.rpcUrl,
    contractAddress: demoConfig.contractAddress,
    resolverPrivateKey: demoConfig.resolverPrivateKey,
    marketId,
    workerEndpoints: new Map(Object.entries(demoConfig.workerEndpoints)),
  };

  // Run the resolution workflow
  console.log(`\nResolving market #${marketId}...\n`);
  const result = await runResolutionWorkflow(workflowConfig);

  // Post-resolution: read balances and reputation
  console.log("--- Post-Resolution State ---\n");
  const provider = new ethers.JsonRpcProvider(demoConfig.rpcUrl);
  const artifactPath = resolve(
    __dirname,
    "../contracts/out/CREsolverMarket.sol/CREsolverMarket.json",
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  const contract = new ethers.Contract(
    demoConfig.contractAddress,
    artifact.abi,
    provider,
  );

  const rows: string[][] = [];
  for (const worker of demoConfig.workers) {
    const balance = await contract.balances(worker.address);
    const [resQ, srcQ, depth, count] = await contract.getReputation(
      worker.address,
    );
    rows.push([
      worker.name,
      worker.address.slice(0, 12) + "...",
      ethers.formatEther(balance) + " ETH",
      `${resQ}/${srcQ}/${depth}`,
      count.toString(),
    ]);
  }

  // Print table
  console.log(
    "Worker       | Address        | Balance      | Rep (R/S/D) | Count",
  );
  console.log(
    "-------------|----------------|--------------|-------------|------",
  );
  for (const row of rows) {
    console.log(
      `${row[0].padEnd(13)}| ${row[1].padEnd(15)}| ${row[2].padEnd(13)}| ${row[3].padEnd(12)}| ${row[4]}`,
    );
  }

  console.log(`\nResolution: ${result.resolution.resolution ? "YES" : "NO"}`);
  console.log(`TX: ${result.txHash}`);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});

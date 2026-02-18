import { ethers } from "ethers";
import { CREsolverMarketABI } from "./abi.js";
import type { WorkflowConfig, ResolutionResult } from "./types.js";

export async function step6Write(
  config: WorkflowConfig,
  result: ResolutionResult,
): Promise<string> {
  console.log(
    `[Step 6 WRITE] Submitting resolution on-chain (market ${config.marketId})...`,
  );

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const signer = new ethers.Wallet(config.resolverPrivateKey, provider);
  const contract = new ethers.Contract(
    config.contractAddress,
    CREsolverMarketABI,
    signer,
  );

  // Convert dimScores to uint8 array
  const dimScoresU8 = result.dimScores.map((s) =>
    Math.max(0, Math.min(100, Math.round(s))),
  );

  console.log(
    `  Workers: ${result.workers.length} | Resolution: ${result.resolution ? "YES" : "NO"}`,
  );
  console.log(`  Weights: [${result.weights.join(", ")}]`);
  console.log(`  DimScores: [${dimScoresU8.join(", ")}]`);

  const tx = await contract.resolveMarket(
    config.marketId,
    result.workers,
    result.weights,
    dimScoresU8,
    result.resolution,
  );

  console.log(`  TX submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(
    `  TX confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed.toString()})`,
  );

  return tx.hash;
}

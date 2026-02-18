import { ethers } from "ethers";
import { CREsolverMarketABI } from "./abi.js";
import type { WorkflowConfig, Market, WorkerInfo, Reputation } from "./types.js";

export interface ReadResult {
  market: Market;
  workers: WorkerInfo[];
}

export async function step1Read(config: WorkflowConfig): Promise<ReadResult> {
  console.log(`[Step 1 READ] Reading market ${config.marketId}...`);

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const contract = new ethers.Contract(
    config.contractAddress,
    CREsolverMarketABI,
    provider,
  );

  // Read market data
  const rawMarket = await contract.getMarket(config.marketId);
  const market: Market = {
    question: rawMarket.question,
    rewardPool: rawMarket.rewardPool,
    deadline: rawMarket.deadline,
    creator: rawMarket.creator,
    resolved: rawMarket.resolved,
  };

  if (market.resolved) {
    throw new Error(`Market ${config.marketId} is already resolved`);
  }

  // Read worker addresses from contract
  const workerAddresses: string[] = await contract.getMarketWorkers(
    config.marketId,
  );

  // Build WorkerInfo array with endpoints from config
  const workers: WorkerInfo[] = [];
  for (const addr of workerAddresses) {
    const endpoint = config.workerEndpoints.get(addr.toLowerCase());
    if (!endpoint) {
      console.warn(`  [SKIP] No endpoint configured for worker ${addr}`);
      continue;
    }

    const stake: bigint = await contract.stakes(config.marketId, addr);
    const [resQuality, srcQuality, analysisDepth, count] =
      await contract.getReputation(addr);

    const reputation: Reputation = {
      resQuality: Number(resQuality),
      srcQuality: Number(srcQuality),
      analysisDepth: Number(analysisDepth),
      count: Number(count),
    };

    workers.push({ address: addr, endpoint, stake, reputation });
  }

  if (workers.length === 0) {
    throw new Error("No workers with configured endpoints found");
  }

  console.log(
    `  Market: "${market.question.slice(0, 60)}..." | Pool: ${ethers.formatEther(market.rewardPool)} ETH | Workers: ${workers.length}`,
  );

  return { market, workers };
}

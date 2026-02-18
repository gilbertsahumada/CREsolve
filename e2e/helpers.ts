import { ethers } from "ethers";
import { readFileSync } from "node:fs";

// ─── ABI fragment for on-chain reads ─────────────────────────────────────────

export const CREsolverMarketABI = [
  "function getMarket(uint256 marketId) view returns (tuple(string question, uint256 rewardPool, uint256 deadline, address creator, bool resolved))",
  "function getMarketWorkers(uint256 marketId) view returns (address[])",
  "function getReputation(address worker) view returns (uint256 resQuality, uint256 srcQuality, uint256 analysisDepth, uint256 count)",
  "function stakes(uint256 marketId, address worker) view returns (uint256)",
  "function balances(address) view returns (uint256)",
  "function marketCount() view returns (uint256)",
  "function resolveMarket(uint256 marketId, address[] workers, uint256[] weights, uint8[] dimScores, bool resolution)",
];

// ─── Polling helpers ─────────────────────────────────────────────────────────

export async function waitForAnvil(
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

export async function waitForAgent(
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
      // not ready yet
    }
    await sleep(intervalMs);
  }
  throw new Error(`Agent ${name} not ready at ${baseUrl} after ${timeoutMs}ms`);
}

// ─── On-chain verification ──────────────────────────────────────────────────

export interface OnChainVerifier {
  getMarket(marketId: number): Promise<{
    question: string;
    rewardPool: bigint;
    deadline: bigint;
    creator: string;
    resolved: boolean;
  }>;
  getMarketWorkers(marketId: number): Promise<string[]>;
  getReputation(worker: string): Promise<{
    resQuality: bigint;
    srcQuality: bigint;
    analysisDepth: bigint;
    count: bigint;
  }>;
  getBalance(worker: string): Promise<bigint>;
  getMarketCount(): Promise<bigint>;
}

export function createOnChainVerifier(
  rpcUrl: string,
  contractAddress: string,
): OnChainVerifier {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(
    contractAddress,
    CREsolverMarketABI,
    provider,
  );

  return {
    async getMarket(marketId: number) {
      const m = await contract.getMarket(marketId);
      return {
        question: m[0],
        rewardPool: m[1],
        deadline: m[2],
        creator: m[3],
        resolved: m[4],
      };
    },
    async getMarketWorkers(marketId: number) {
      return contract.getMarketWorkers(marketId);
    },
    async getReputation(worker: string) {
      const [resQuality, srcQuality, analysisDepth, count] =
        await contract.getReputation(worker);
      return { resQuality, srcQuality, analysisDepth, count };
    },
    async getBalance(worker: string) {
      return contract.balances(worker);
    },
    async getMarketCount() {
      return contract.marketCount();
    },
  };
}

// ─── Config loader ──────────────────────────────────────────────────────────

export interface DemoConfig {
  rpcUrl: string;
  contractAddress: string;
  resolverPrivateKey: string;
  workerEndpoints: Record<string, string>;
  workers: Array<{
    name: string;
    address: string;
    privateKey: string;
    port: number;
  }>;
  marketCount: number;
  markets: Array<{
    question: string;
    rewardEth: string;
    durationSeconds: number;
  }>;
}

export function loadDemoConfig(path: string): DemoConfig {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ─── Utilities ──────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

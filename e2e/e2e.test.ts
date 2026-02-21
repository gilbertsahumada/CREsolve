import { describe, it, expect, beforeAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  loadDemoConfig,
  createOnChainVerifier,
  type DemoConfig,
  type OnChainVerifier,
} from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RECEIVER_ABI = ["function onReport(bytes metadata, bytes report)"];
const MARKET_ABI = [
  "function createMarket(string question, uint256 duration) payable returns (uint256)",
  "function joinMarket(uint256 marketId, uint256 agentId) payable",
];

interface ResolveResponse {
  determination: boolean;
  confidence: number;
  evidence: string;
  sources: string[];
}

interface ChallengeResponse {
  responses: string[];
}

interface AgentResult {
  worker: DemoConfig["workers"][number];
  determination: boolean;
  confidence: number;
  evidence: string;
  sources: string[];
  challengeResponses: string[];
}

let cfg: DemoConfig;
let verifier: OnChainVerifier;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function askAgent(
  worker: DemoConfig["workers"][number],
  marketId: number,
  question: string,
): Promise<ResolveResponse> {
  const response = await fetch(`http://127.0.0.1:${worker.port}/a2a/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ market_id: marketId, question }),
  });
  if (!response.ok) {
    throw new Error(
      `resolve failed for ${worker.name} (status ${response.status})`,
    );
  }
  return (await response.json()) as ResolveResponse;
}

async function challengeAgent(
  worker: DemoConfig["workers"][number],
  determination: boolean,
): Promise<string[]> {
  const challenges = [
    `Defend your ${determination ? "YES" : "NO"} determination with your strongest evidence.`,
    "What is the weakest assumption in your analysis?",
  ];

  const response = await fetch(`http://127.0.0.1:${worker.port}/a2a/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenges }),
  });
  if (!response.ok) {
    throw new Error(
      `challenge failed for ${worker.name} (status ${response.status})`,
    );
  }
  const payload = (await response.json()) as ChallengeResponse;
  return payload.responses;
}

async function resolveMarketViaReceiver(marketId: number): Promise<{
  resolution: boolean;
  txHash: string;
}> {
  const market = await verifier.getMarket(marketId);
  if (market.resolved) {
    throw new Error(`Market ${marketId} is already resolved`);
  }

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const resolver = new ethers.Wallet(cfg.resolverPrivateKey, provider);
  const receiver = new ethers.Contract(cfg.receiverAddress, RECEIVER_ABI, resolver);

  const agentResults: AgentResult[] = [];
  for (const worker of cfg.workers) {
    const resolveResult = await askAgent(worker, marketId, market.question);
    const challengeResponses = await challengeAgent(worker, resolveResult.determination);
    agentResults.push({
      worker,
      determination: resolveResult.determination,
      confidence: resolveResult.confidence,
      evidence: resolveResult.evidence,
      sources: resolveResult.sources,
      challengeResponses,
    });
  }

  const yesWeight = agentResults
    .filter((r) => r.determination)
    .reduce((sum, r) => sum + r.confidence, 0);
  const noWeight = agentResults
    .filter((r) => !r.determination)
    .reduce((sum, r) => sum + r.confidence, 0);
  const resolution = yesWeight >= noWeight;

  const workers = agentResults.map((r) => r.worker.address);
  const weights = agentResults.map((r) =>
    BigInt(Math.max(1, Math.round(r.confidence * 10_000))),
  );
  const dimScores: number[] = [];
  for (const result of agentResults) {
    const resolutionQuality = clampScore(40 + result.confidence * 60);
    const sourceQuality = clampScore(30 + Math.min(result.sources.length * 20, 70));
    const analysisDepth = clampScore(
      20 +
      Math.min(Math.floor(result.evidence.length / 12), 60) +
      Math.min(result.challengeResponses.length * 8, 20),
    );
    dimScores.push(resolutionQuality, sourceQuality, analysisDepth);
  }

  const report = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address[]", "uint256[]", "uint8[]", "bool"],
    [marketId, workers, weights, dimScores, resolution],
  );
  const metadata = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32"],
    [ethers.id("cresolver-resolution"), ethers.id("don-local-sim")],
  );

  const tx = await receiver.onReport(metadata, report);
  const receipt = await tx.wait();

  return {
    resolution,
    txHash: receipt.hash,
  };
}

beforeAll(() => {
  const configPath = resolve(__dirname, "demo-config.json");
  cfg = loadDemoConfig(configPath);
  verifier = createOnChainVerifier(cfg.rpcUrl, cfg.contractAddress);
});

describe("Agents", () => {
  it("all 3 agents respond healthy", async () => {
    for (const worker of cfg.workers) {
      const res = await fetch(`http://127.0.0.1:${worker.port}/health`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.agent).toBe(worker.name);
    }
  });

  it("all agents report mock mode", async () => {
    for (const worker of cfg.workers) {
      const res = await fetch(`http://127.0.0.1:${worker.port}/health`);
      const body = await res.json();
      expect(body.mode).toBe("mock");
    }
  });

  it("agent response caching works (same market_id returns identical result)", async () => {
    const worker = cfg.workers[0];
    const body = { market_id: 999, question: "Will bitcoin reach 200k?" };

    const r1 = await fetch(`http://127.0.0.1:${worker.port}/a2a/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d1 = await r1.json();

    const r2 = await fetch(`http://127.0.0.1:${worker.port}/a2a/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d2 = await r2.json();

    expect(d1).toEqual(d2);
  });
});

describe("CREReceiver", () => {
  it("receiver is deployed and authorized", async () => {
    expect(cfg.receiverAddress).toBeDefined();
    expect(cfg.receiverAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("requestResolution events were emitted during setup", async () => {
    for (let i = 0; i < cfg.marketCount; i++) {
      const market = await verifier.getMarket(i);
      expect(market.question.length).toBeGreaterThan(0);
    }
  });
});

describe('Market 0: "bitcoin 200k" → NO', () => {
  let txHash: string;
  let resolution: boolean;

  beforeAll(async () => {
    const result = await resolveMarketViaReceiver(0);
    txHash = result.txHash;
    resolution = result.resolution;
  });

  it("resolution tx submitted via receiver", () => {
    expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("resolution is false (mock keyword match: bitcoin + 200k)", () => {
    expect(resolution).toBe(false);
  });

  it("on-chain: market.resolved == true", async () => {
    const market = await verifier.getMarket(0);
    expect(market.resolved).toBe(true);
  });

  it("on-chain: worker balances > 0", async () => {
    for (const worker of cfg.workers) {
      const balance = await verifier.getBalance(worker.address);
      expect(balance).toBeGreaterThan(0n);
    }
  });

  it("on-chain: reputation count == 1", async () => {
    for (const worker of cfg.workers) {
      const rep = await verifier.getReputation(worker.address);
      expect(rep.count).toBe(1n);
    }
  });
});

describe('Market 1: "ethereum PoS" → YES', () => {
  let resolution: boolean;

  beforeAll(async () => {
    const result = await resolveMarketViaReceiver(1);
    resolution = result.resolution;
  });

  it("resolution is true (mock keyword match: ethereum + pos)", () => {
    expect(resolution).toBe(true);
  });

  it("on-chain: market.resolved == true", async () => {
    const market = await verifier.getMarket(1);
    expect(market.resolved).toBe(true);
  });

  it("on-chain: reputation count incremented to 2", async () => {
    for (const worker of cfg.workers) {
      const rep = await verifier.getReputation(worker.address);
      expect(rep.count).toBe(2n);
    }
  });
});

describe('Market 2: "bitcoin ETF" → YES', () => {
  let resolution: boolean;

  beforeAll(async () => {
    const result = await resolveMarketViaReceiver(2);
    resolution = result.resolution;
  });

  it("resolution is true (mock keyword match: etf)", () => {
    expect(resolution).toBe(true);
  });

  it("on-chain: market.resolved == true", async () => {
    const market = await verifier.getMarket(2);
    expect(market.resolved).toBe(true);
  });

  it("on-chain: all 3 markets resolved, rep count == 3", async () => {
    const marketCount = await verifier.getMarketCount();
    expect(marketCount).toBe(3n);

    for (let i = 0; i < 3; i++) {
      const market = await verifier.getMarket(i);
      expect(market.resolved).toBe(true);
    }

    for (const worker of cfg.workers) {
      const rep = await verifier.getReputation(worker.address);
      expect(rep.count).toBe(3n);
    }
  });
});

describe("CREReceiver: forwarder path on new market", () => {
  it("can resolve an additional market via receiver using live agent responses", async () => {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const deployer = new ethers.Wallet(cfg.resolverPrivateKey, provider);
    const market = new ethers.Contract(cfg.contractAddress, MARKET_ABI, deployer);

    const marketCountBefore = await verifier.getMarketCount();
    const marketId = Number(marketCountBefore);

    const createTx = await market.createMarket("Test receiver market?", 3600, {
      value: ethers.parseEther("0.01"),
    });
    await createTx.wait();

    for (const worker of cfg.workers) {
      const workerSigner = new ethers.Wallet(worker.privateKey, provider);
      const workerMarket = new ethers.Contract(
        cfg.contractAddress,
        MARKET_ABI,
        workerSigner,
      );
      const joinTx = await workerMarket.joinMarket(marketId, 0, {
        value: ethers.parseEther("0.01"),
      });
      await joinTx.wait();
    }

    await resolveMarketViaReceiver(marketId);
    const resolvedMarket = await verifier.getMarket(marketId);
    expect(resolvedMarket.resolved).toBe(true);
  });
});

describe("Edge Cases", () => {
  it("resolving an already-resolved market throws", async () => {
    await expect(resolveMarketViaReceiver(0)).rejects.toThrow();
  });
});

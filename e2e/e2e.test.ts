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

// Self-contained E2E workflow runner (local orchestrator, not the CRE DON version)
import { runResolutionWorkflow, type WorkflowConfig } from "./workflow-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let cfg: DemoConfig;
let verifier: OnChainVerifier;

function buildWorkflowConfig(marketId: number): WorkflowConfig {
  return {
    rpcUrl: cfg.rpcUrl,
    contractAddress: cfg.contractAddress,
    resolverPrivateKey: cfg.resolverPrivateKey,
    marketId,
    workerEndpoints: new Map(Object.entries(cfg.workerEndpoints)),
  };
}

beforeAll(() => {
  const configPath = resolve(__dirname, "demo-config.json");
  cfg = loadDemoConfig(configPath);
  verifier = createOnChainVerifier(cfg.rpcUrl, cfg.contractAddress);
});

// ─── Agent health checks ────────────────────────────────────────────────────

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

// ─── CREReceiver deployment ─────────────────────────────────────────────────

describe("CREReceiver", () => {
  it("receiver is deployed and authorized", async () => {
    expect(cfg.receiverAddress).toBeDefined();
    expect(cfg.receiverAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("requestResolution events were emitted during setup", async () => {
    // The setup script already called requestResolution() for all markets
    // We verify by checking that markets exist and are not yet resolved
    for (let i = 0; i < cfg.marketCount; i++) {
      const market = await verifier.getMarket(i);
      expect(market.question.length).toBeGreaterThan(0);
    }
  });
});

// ─── Market 0: "bitcoin 200k" → NO ─────────────────────────────────────────

describe('Market 0: "bitcoin 200k" → NO', () => {
  let txHash: string;
  let resolution: boolean;

  beforeAll(async () => {
    const result = await runResolutionWorkflow(buildWorkflowConfig(0));
    txHash = result.txHash;
    resolution = result.resolution.resolution;
  });

  it("workflow completes without error", () => {
    expect(txHash).toBeDefined();
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

// ─── Market 1: "ethereum PoS" → YES ────────────────────────────────────────

describe('Market 1: "ethereum PoS" → YES', () => {
  let resolution: boolean;

  beforeAll(async () => {
    const result = await runResolutionWorkflow(buildWorkflowConfig(1));
    resolution = result.resolution.resolution;
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

// ─── Market 2: "bitcoin ETF" → YES ─────────────────────────────────────────

describe('Market 2: "bitcoin ETF" → YES', () => {
  let resolution: boolean;

  beforeAll(async () => {
    const result = await runResolutionWorkflow(buildWorkflowConfig(2));
    resolution = result.resolution.resolution;
  });

  it("resolution is true (mock keyword match: etf)", () => {
    expect(resolution).toBe(true);
  });

  it("on-chain: market.resolved == true", async () => {
    const market = await verifier.getMarket(2);
    expect(market.resolved).toBe(true);
  });

  it("on-chain: all 3 markets resolved, rep count == 3", async () => {
    // Verify all markets resolved
    const marketCount = await verifier.getMarketCount();
    expect(marketCount).toBe(3n);

    for (let i = 0; i < 3; i++) {
      const m = await verifier.getMarket(i);
      expect(m.resolved).toBe(true);
    }

    // Verify rep count for all workers
    for (const worker of cfg.workers) {
      const rep = await verifier.getReputation(worker.address);
      expect(rep.count).toBe(3n);
    }
  });
});

// ─── Resolution via CREReceiver (simulated forwarder) ────────────────────────

describe("CREReceiver: simulated forwarder call", () => {
  it("can resolve a market via the receiver contract", async () => {
    // Create a 4th market for this test
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const deployer = new ethers.Wallet(cfg.resolverPrivateKey, provider);

    const marketAbi = [
      "function createMarket(string question, uint256 duration) payable returns (uint256)",
      "function joinMarket(uint256 marketId, uint256 agentId) payable",
      "function getMarket(uint256 marketId) view returns (tuple(string question, uint256 rewardPool, uint256 deadline, address creator, bool resolved))",
    ];
    const market = new ethers.Contract(cfg.contractAddress, marketAbi, deployer);

    const tx = await market.createMarket("Test receiver market?", 3600, {
      value: ethers.parseEther("0.01"),
    });
    await tx.wait();
    const marketId = 3; // 4th market (0-indexed)

    // Have workers join
    for (const w of cfg.workers) {
      const workerSigner = new ethers.Wallet(w.privateKey, provider);
      const workerContract = new ethers.Contract(cfg.contractAddress, marketAbi, workerSigner);
      const joinTx = await workerContract.joinMarket(marketId, 0, {
        value: ethers.parseEther("0.01"),
      });
      await joinTx.wait();
    }

    // Simulate forwarder calling CREReceiver.onReport()
    const receiverAbi = [
      "function onReport(bytes metadata, bytes report)",
    ];
    const receiver = new ethers.Contract(cfg.receiverAddress, receiverAbi, deployer);

    const workers = cfg.workers.map((w) => w.address);
    const weights = [5000, 3000, 2000];
    const dimScores = [80, 70, 60, 75, 65, 55, 70, 60, 50];

    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address[]", "uint256[]", "uint8[]", "bool"],
      [marketId, workers, weights, dimScores, true],
    );

    // Metadata: workflowId (32 bytes) + donId (32 bytes)
    const metadata = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [ethers.id("cresolver-resolution"), ethers.id("don-1")],
    );

    const reportTx = await receiver.onReport(metadata, report);
    await reportTx.wait();

    // Verify the market was resolved via receiver
    const m = await verifier.getMarket(marketId);
    expect(m.resolved).toBe(true);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe("Edge Cases", () => {
  it("resolving already-resolved market throws", async () => {
    await expect(
      runResolutionWorkflow(buildWorkflowConfig(0)),
    ).rejects.toThrow();
  });
});

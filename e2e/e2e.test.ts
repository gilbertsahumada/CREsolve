import { describe, it, expect, beforeAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDemoConfig,
  createOnChainVerifier,
  type DemoConfig,
  type OnChainVerifier,
} from "./helpers.js";

// Import workflow runner directly
import { runResolutionWorkflow } from "../cre-workflow/src/index.js";
import type { WorkflowConfig } from "../cre-workflow/src/types.js";

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

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe("Edge Cases", () => {
  it("resolving already-resolved market throws", async () => {
    await expect(
      runResolutionWorkflow(buildWorkflowConfig(0)),
    ).rejects.toThrow();
  });
});

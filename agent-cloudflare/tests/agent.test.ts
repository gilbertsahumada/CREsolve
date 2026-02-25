import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index.js";
import { clearCache as clearInvestigatorCache } from "../src/services/investigator.js";
import { clearCache as clearDefenderCache } from "../src/services/defender.js";

const env = {
  AGENT_NAME: "Alpha",
  LLM_MODEL: "gpt-4o-mini",
};

function req(path: string, init?: RequestInit) {
  return app.request(path, init, env);
}

function post(path: string, body: unknown) {
  return req(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  clearInvestigatorCache();
  clearDefenderCache();
});

describe("GET /health", () => {
  it("returns ok status with agent info", async () => {
    const res = await req("/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toHaveProperty("status", "ok");
    expect(data).toHaveProperty("agent", "Alpha");
    expect(data).toHaveProperty("mode", "mock");
  });
});

describe("POST /a2a/resolve", () => {
  it("rejects invalid input", async () => {
    const res = await post("/a2a/resolve", {});
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toHaveProperty("error");
  });

  it("returns correct shape in mock mode", async () => {
    const res = await post("/a2a/resolve", {
      market_id: 0,
      question: "Will Ethereum switch to PoS?",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      determination: boolean;
      confidence: number;
      evidence: string;
      sources: string[];
    };
    expect(data).toHaveProperty("determination");
    expect(data).toHaveProperty("confidence");
    expect(data).toHaveProperty("evidence");
    expect(data).toHaveProperty("sources");
    expect(typeof data.determination).toBe("boolean");
    expect(typeof data.confidence).toBe("number");
    expect(data.confidence).toBeGreaterThanOrEqual(0);
    expect(data.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(data.sources)).toBe(true);
  });

  it("same market_id returns identical cached response", async () => {
    const body = { market_id: 42, question: "Will bitcoin reach 200k by end of year?" };

    const r1 = await post("/a2a/resolve", body);
    const d1 = (await r1.json()) as Record<string, unknown>;

    const r2 = await post("/a2a/resolve", body);
    const d2 = (await r2.json()) as Record<string, unknown>;

    expect(d1).toEqual(d2);
  });
});

describe("POST /a2a/challenge", () => {
  it("rejects invalid input", async () => {
    const res = await post("/a2a/challenge", {});
    expect(res.status).toBe(400);
  });

  it("returns N responses for N challenges", async () => {
    const challenges = [
      "What evidence supports your claim?",
      "Could there be bias in your analysis?",
      "How confident are you really?",
    ];
    const res = await post("/a2a/challenge", { challenges });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { responses: string[] };
    expect(data).toHaveProperty("responses");
    expect(data.responses).toHaveLength(3);
  });
});

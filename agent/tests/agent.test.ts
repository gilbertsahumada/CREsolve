import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/index.js";
import { clearCache as clearInvestigatorCache } from "../src/services/investigator.js";
import { clearCache as clearDefenderCache } from "../src/services/defender.js";

function req(path: string, init?: RequestInit) {
  return app.request(path, init);
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
    const data = await res.json();
    expect(data).toHaveProperty("status", "ok");
    expect(data).toHaveProperty("agent");
    expect(data).toHaveProperty("mode", "mock");
  });
});

describe("POST /a2a/resolve", () => {
  it("rejects invalid input", async () => {
    const res = await post("/a2a/resolve", {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  it("rejects missing question", async () => {
    const res = await post("/a2a/resolve", { market_id: 0 });
    expect(res.status).toBe(400);
  });

  it("returns correct shape in mock mode", async () => {
    const res = await post("/a2a/resolve", {
      market_id: 0,
      question: "Will Ethereum switch to PoS?",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
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

  it("mock mode is deterministic", async () => {
    const body = { market_id: 1, question: "Will bitcoin reach 200k?" };
    const r1 = await post("/a2a/resolve", body);
    const r2 = await post("/a2a/resolve", body);
    const d1 = await r1.json();
    const d2 = await r2.json();
    expect(d1.determination).toBe(d2.determination);
    expect(d1.confidence).toBe(d2.confidence);
  });

  it("bitcoin 200k returns false", async () => {
    const res = await post("/a2a/resolve", {
      market_id: 0,
      question: "Will bitcoin reach 200k by end of year?",
    });
    const data = await res.json();
    expect(data.determination).toBe(false);
    expect(data.confidence).toBe(0.65);
  });

  it("ethereum pos returns true", async () => {
    const res = await post("/a2a/resolve", {
      market_id: 0,
      question: "Has ethereum transitioned to pos?",
    });
    const data = await res.json();
    expect(data.determination).toBe(true);
    expect(data.confidence).toBe(0.99);
  });
});

describe("POST /a2a/challenge", () => {
  it("rejects invalid input", async () => {
    const res = await post("/a2a/challenge", {});
    expect(res.status).toBe(400);
  });

  it("rejects empty challenges array", async () => {
    const res = await post("/a2a/challenge", { challenges: [] });
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
    const data = await res.json();
    expect(data).toHaveProperty("responses");
    expect(data.responses).toHaveLength(3);
    data.responses.forEach((r: unknown) => {
      expect(typeof r).toBe("string");
      expect((r as string).length).toBeGreaterThan(0);
    });
  });
});

describe("Response caching", () => {
  it("same market_id returns identical cached response for investigator", async () => {
    const body = { market_id: 42, question: "Will bitcoin reach 200k by end of year?" };

    const r1 = await post("/a2a/resolve", body);
    const d1 = await r1.json();

    const r2 = await post("/a2a/resolve", body);
    const d2 = await r2.json();

    // Responses should be byte-for-byte identical (cached)
    expect(d1).toEqual(d2);
  });

  it("different market_ids get independent responses", async () => {
    const body1 = { market_id: 100, question: "Will bitcoin reach 200k?" };
    const body2 = { market_id: 101, question: "Will bitcoin reach 200k?" };

    const r1 = await post("/a2a/resolve", body1);
    const d1 = await r1.json();

    const r2 = await post("/a2a/resolve", body2);
    const d2 = await r2.json();

    // Both should have valid responses (same question, same mock result)
    expect(d1.determination).toBe(d2.determination);
    expect(d1.confidence).toBe(d2.confidence);
  });

  it("same challenges return identical cached response for defender", async () => {
    const challenges = ["What evidence?", "Any bias?"];

    const r1 = await post("/a2a/challenge", { challenges });
    const d1 = await r1.json();

    const r2 = await post("/a2a/challenge", { challenges });
    const d2 = await r2.json();

    expect(d1).toEqual(d2);
  });
});

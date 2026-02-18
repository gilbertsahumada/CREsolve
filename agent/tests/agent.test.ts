import { describe, it, expect } from "vitest";
import { app } from "../src/index.js";

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

import type { ResolveResponse } from "../../../shared/types.js";
import { config } from "../config.js";

// ─── Mock mode: deterministic keyword-based responses ────────────────────────

function hashQuestion(question: string): number {
  let hash = 0;
  for (let i = 0; i < question.length; i++) {
    hash = (hash * 31 + question.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function mockInvestigate(question: string): ResolveResponse {
  const q = question.toLowerCase();

  if (q.includes("bitcoin") && q.includes("200k")) {
    return {
      determination: false,
      confidence: 0.65,
      evidence:
        "Bitcoin reaching $200k requires sustained institutional adoption and favorable macro conditions. Current market dynamics and historical volatility patterns suggest this target is unlikely within the specified timeframe.",
      sources: [
        "https://coinmarketcap.com",
        "https://glassnode.com",
        "https://messari.io",
      ],
    };
  }

  if (q.includes("ethereum") && q.includes("pos")) {
    return {
      determination: true,
      confidence: 0.99,
      evidence:
        "Ethereum successfully transitioned to Proof of Stake via The Merge on September 15, 2022. The beacon chain has been running stably with over 900k validators. This is a verified historical fact.",
      sources: [
        "https://ethereum.org/en/roadmap/merge/",
        "https://beaconcha.in",
        "https://etherscan.io",
      ],
    };
  }

  if (q.includes("etf")) {
    return {
      determination: true,
      confidence: 0.72,
      evidence:
        "Multiple spot Bitcoin ETFs were approved by the SEC in January 2024. ETF approval has been a significant catalyst for institutional adoption and price appreciation.",
      sources: [
        "https://sec.gov",
        "https://bloomberg.com",
        "https://coindesk.com",
      ],
    };
  }

  // Default: deterministic based on question hash
  const hash = hashQuestion(question);
  const determination = hash % 2 === 0;
  const confidence = 0.5 + (hash % 40) / 100;

  return {
    determination,
    confidence,
    evidence: `Analysis of "${question.slice(0, 60)}..." based on available data and historical patterns. The determination considers multiple factors including market conditions, historical precedent, and current trends.`,
    sources: ["https://example.com/analysis", "https://example.com/data"],
  };
}

// ─── LLM mode ────────────────────────────────────────────────────────────────

async function llmInvestigate(question: string): Promise<ResolveResponse> {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: config.llmApiKey });

  const completion = await openai.chat.completions.create({
    model: config.llmModel,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a research investigator for a prediction market resolution system.
Your job is to determine whether a given question/claim is TRUE or FALSE based on available evidence.

Respond with a JSON object:
{
  "determination": boolean,
  "confidence": number (0-1),
  "evidence": "detailed explanation of your reasoning and findings",
  "sources": ["list of relevant sources or references"]
}

Be thorough but concise. Base your determination on facts and evidence.`,
      },
      {
        role: "user",
        content: `Investigate and determine: ${question}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty LLM response");

  const parsed = JSON.parse(content);
  return {
    determination: Boolean(parsed.determination),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence))),
    evidence: String(parsed.evidence),
    sources: Array.isArray(parsed.sources)
      ? parsed.sources.map(String)
      : [],
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function investigate(question: string): Promise<ResolveResponse> {
  if (config.isLlmMode) {
    return llmInvestigate(question);
  }
  return mockInvestigate(question);
}

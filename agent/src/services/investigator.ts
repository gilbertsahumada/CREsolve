import { config } from "../config.js";

interface ResolveResponse {
  determination: boolean;
  confidence: number;
  evidence: string;
  sources: string[];
}

// ─── Response cache (critical for CRE consensus: all DON nodes get identical responses) ─

interface CacheEntry {
  response: ResolveResponse;
  timestamp: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const responseCache = new Map<number, CacheEntry>();

function getCached(marketId: number): ResolveResponse | null {
  const entry = responseCache.get(marketId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    responseCache.delete(marketId);
    return null;
  }
  return entry.response;
}

function setCache(marketId: number, response: ResolveResponse): void {
  responseCache.set(marketId, { response, timestamp: Date.now() });
}

/** Exposed for testing */
export function clearCache(): void {
  responseCache.clear();
}

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

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function llmInvestigate(question: string): Promise<ResolveResponse> {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: config.llmApiKey });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: config.llmModel,
        temperature: 0,
        seed: 42,
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
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Unreachable");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function investigate(question: string, marketId?: number): Promise<ResolveResponse> {
  // Check cache if market_id is provided
  if (marketId !== undefined) {
    const cached = getCached(marketId);
    if (cached) return cached;
  }

  let result: ResolveResponse;
  if (config.isLlmMode) {
    result = await llmInvestigate(question);
  } else {
    result = mockInvestigate(question);
  }

  // Cache the result
  if (marketId !== undefined) {
    setCache(marketId, result);
  }

  return result;
}

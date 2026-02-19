import { config } from "../config.js";

// ─── Response cache (for CRE consensus determinism) ─────────────────────────

interface CacheEntry {
  responses: string[];
  timestamp: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const responseCache = new Map<string, CacheEntry>();

function hashChallenges(challenges: string[]): string {
  // Simple deterministic hash of the challenges array
  return challenges.join("\x00");
}

function getCached(challenges: string[]): string[] | null {
  const key = hashChallenges(challenges);
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry.responses;
}

function setCache(challenges: string[], responses: string[]): void {
  const key = hashChallenges(challenges);
  responseCache.set(key, { responses, timestamp: Date.now() });
}

/** Exposed for testing */
export function clearCache(): void {
  responseCache.clear();
}

// ─── Mock mode ───────────────────────────────────────────────────────────────

function mockDefend(challenges: string[]): string[] {
  return challenges.map((challenge) => {
    const c = challenge.toLowerCase();
    if (c.includes("evidence") || c.includes("proof")) {
      return `The evidence is based on verifiable on-chain data and reputable market analysis sources. Specifically, ${challenge.slice(0, 50)}... is addressed by cross-referencing multiple independent data providers.`;
    }
    if (c.includes("bias") || c.includes("assumption")) {
      return `The analysis accounts for potential biases by using a multi-source approach. The determination was reached by weighing conflicting viewpoints and prioritizing empirical data over speculation.`;
    }
    if (c.includes("confidence") || c.includes("certain")) {
      return `The confidence level reflects the strength of available evidence. Higher confidence is assigned when multiple independent sources corroborate the finding. Uncertainty is explicitly acknowledged where data is incomplete.`;
    }
    return `Regarding "${challenge.slice(0, 40)}...": The determination stands based on the weight of evidence gathered. The analysis methodology follows a systematic review of available data, cross-referenced with historical patterns and current conditions.`;
  });
}

// ─── LLM mode ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function llmDefend(challenges: string[]): Promise<string[]> {
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
            content: `You are defending your previous research determination against challenges.
Respond to each challenge with a well-reasoned defense.

Respond with a JSON object:
{ "responses": ["response to challenge 1", "response to challenge 2", ...] }

Be thorough but concise. Address each challenge directly.`,
          },
          {
            role: "user",
            content: `Defend against these challenges:\n${challenges.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
          },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error("Empty LLM response");

      const parsed = JSON.parse(content);
      return Array.isArray(parsed.responses)
        ? parsed.responses.map(String)
        : challenges.map(() => "Unable to parse defense response.");
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Unreachable");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function defend(challenges: string[]): Promise<string[]> {
  // Check cache
  const cached = getCached(challenges);
  if (cached) return cached;

  let responses: string[];
  if (config.isLlmMode) {
    responses = await llmDefend(challenges);
  } else {
    responses = mockDefend(challenges);
  }

  // Cache the result
  setCache(challenges, responses);

  return responses;
}

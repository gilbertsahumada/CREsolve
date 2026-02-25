import OpenAI from "openai";
import type { AgentConfig } from "../config.js";

interface CacheEntry {
  responses: string[];
  timestamp: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const responseCache = new Map<string, CacheEntry>();

function hashChallenges(challenges: string[]): string {
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

export function clearCache(): void {
  responseCache.clear();
}

function mockDefend(challenges: string[]): string[] {
  return challenges.map((challenge) => {
    const c = challenge.toLowerCase();
    if (c.includes("evidence") || c.includes("proof")) {
      return `The evidence is based on verifiable on-chain data and reputable market analysis sources. Specifically, ${challenge.slice(0, 50)}... is addressed by cross-referencing multiple independent data providers.`;
    }
    if (c.includes("bias") || c.includes("assumption")) {
      return "The analysis accounts for potential biases by using a multi-source approach. The determination was reached by weighing conflicting viewpoints and prioritizing empirical data over speculation.";
    }
    if (c.includes("confidence") || c.includes("certain")) {
      return "The confidence level reflects the strength of available evidence. Higher confidence is assigned when multiple independent sources corroborate the finding. Uncertainty is explicitly acknowledged where data is incomplete.";
    }
    return `Regarding "${challenge.slice(0, 40)}...": The determination stands based on the weight of evidence gathered. The analysis methodology follows a systematic review of available data, cross-referenced with historical patterns and current conditions.`;
  });
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** Strip markdown fences that the model may wrap around JSON output. */
function cleanJsonContent(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

async function llmDefend(
  challenges: string[],
  config: AgentConfig,
): Promise<string[]> {
  const openai = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: config.llmModel,
        temperature: 0,
        stream: false,
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content: `You are defending your previous research determination against challenges.
Respond to each challenge with a well-reasoned defense.

Return ONLY raw JSON, no markdown fences, no extra text:
{ "responses": ["response to challenge 1", "response to challenge 2", ...] }

Be thorough but concise. Address each challenge directly.`,
          },
          {
            role: "user",
            content: `Defend against these challenges:\n${challenges
              .map((challenge, index) => `${index + 1}. ${challenge}`)
              .join("\n")}`,
          },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error("Empty LLM response");

      const parsed = JSON.parse(cleanJsonContent(content));
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

export async function defend(
  challenges: string[],
  config: AgentConfig,
): Promise<string[]> {
  const cached = getCached(challenges);
  if (cached) return cached;

  const responses = config.isLlmMode
    ? await llmDefend(challenges, config)
    : mockDefend(challenges);

  setCache(challenges, responses);
  return responses;
}

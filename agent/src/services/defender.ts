import { config } from "../config.js";

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

async function llmDefend(challenges: string[]): Promise<string[]> {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: config.llmApiKey });

  const completion = await openai.chat.completions.create({
    model: config.llmModel,
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
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function defend(challenges: string[]): Promise<string[]> {
  if (config.isLlmMode) {
    return llmDefend(challenges);
  }
  return mockDefend(challenges);
}

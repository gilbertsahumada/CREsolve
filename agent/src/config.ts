export const config = {
  port: parseInt(process.env.AGENT_PORT || "3001", 10),
  name: process.env.AGENT_NAME || "Worker",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "gpt-4o-mini",
  get isLlmMode(): boolean {
    return this.llmApiKey.length > 0;
  },
  get mode(): "llm" | "mock" {
    return this.isLlmMode ? "llm" : "mock";
  },
};

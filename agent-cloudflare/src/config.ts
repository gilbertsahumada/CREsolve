export interface AgentBindings {
  AGENT_NAME?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
}

export interface AgentConfig {
  name: string;
  llmApiKey: string;
  llmModel: string;
  isLlmMode: boolean;
  mode: "llm" | "mock";
}

export function getConfig(env: AgentBindings): AgentConfig {
  const llmApiKey = env.LLM_API_KEY || "";

  return {
    name: env.AGENT_NAME || "Worker",
    llmApiKey,
    llmModel: env.LLM_MODEL || "gpt-4o-mini",
    isLlmMode: llmApiKey.length > 0,
    mode: llmApiKey.length > 0 ? "llm" : "mock",
  };
}

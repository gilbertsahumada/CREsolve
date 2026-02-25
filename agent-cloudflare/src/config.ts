export interface AgentBindings {
  AGENT_NAME?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
}

export interface AgentConfig {
  name: string;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  isLlmMode: boolean;
  mode: "llm" | "mock";
}

export function getConfig(env: AgentBindings): AgentConfig {
  const llmApiKey = env.LLM_API_KEY || "";

  return {
    name: env.AGENT_NAME || "Worker",
    llmApiKey,
    llmModel: env.LLM_MODEL || "moonshotai/kimi-k2.5",
    llmBaseUrl: env.LLM_BASE_URL || "https://integrate.api.nvidia.com/v1",
    isLlmMode: llmApiKey.length > 0,
    mode: llmApiKey.length > 0 ? "llm" : "mock",
  };
}

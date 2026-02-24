import { z } from "zod";

// ─── Config schema (validated by CRE Runner) ─────────────────────────────────

const EvmConfigSchema = z.object({
  // Use chainSelectorName for known chains (resolved via getNetwork()),
  // or chain_selector for experimental/local chains (passed directly).
  chainSelectorName: z.string().optional(),
  chain_selector: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
  market_address: z.string(),
  receiver_address: z.string(),
  gasLimit: z.string(),
});

const AgentConfigSchema = z.object({
  name: z.string(),
  endpoint: z.string().regex(/^https?:\/\/.+/),
});

export const ConfigSchema = z.object({
  authorizedEVMAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  evms: z.array(EvmConfigSchema).min(1),
  agents: z.array(AgentConfigSchema).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type EvmConfig = z.infer<typeof EvmConfigSchema>;

// ─── Agent response types ────────────────────────────────────────────────────

export interface AgentResolveResponse {
  determination: boolean;
  confidence: number;
  evidence: string;
  sources: string[];
}

export interface AgentChallengeResponse {
  responses: string[];
}

// ─── Internal workflow types ─────────────────────────────────────────────────

export interface WorkerData {
  address: string;
  endpoint: string;
  stake: bigint;
  reputation: {
    resQuality: number;
    srcQuality: number;
    analysisDepth: number;
    count: number;
  };
}

export interface WorkerDetermination extends AgentResolveResponse {
  workerAddress: string;
}

export interface ChallengeResult {
  workerAddress: string;
  challenges: string[];
  responses: string[];
}

export interface WorkerEvaluation {
  workerAddress: string;
  qualityScore: number;
  resolutionQuality: number;
  sourceQuality: number;
  analysisDepth: number;
}

export interface LLMWorkerScores {
  workerAddress: string;
  resolutionQuality: number;
  sourceQuality: number;
  analysisDepth: number;
  reasoningClarity: number;
  evidenceStrength: number;
  biasAwareness: number;
  timeliness: number;
  collaboration: number;
}

export interface ResolutionResult {
  resolution: boolean;
  workers: string[];
  weights: bigint[];
  dimScores: number[];
}

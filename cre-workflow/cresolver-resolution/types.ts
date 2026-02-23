import { z } from "zod";

// ─── Config schema (validated by CRE Runner) ─────────────────────────────────

const EvmConfigSchema = z.object({
  // Chain selector can exceed JS safe integer range (e.g. Sepolia),
  // so string form is supported and preferred for non-local chains.
  chain_selector: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  market_address: z.string(),
  receiver_address: z.string(),
  gas_limit: z.number(),
});

const AgentConfigSchema = z.object({
  name: z.string(),
  endpoint: z.string().regex(/^https?:\/\/.+/),
});

export const ConfigSchema = z.object({
  evms: z.array(EvmConfigSchema).min(1),
  agents: z.array(AgentConfigSchema).min(1),
});

export type Config = z.infer<typeof ConfigSchema>;
export type EvmConfig = z.infer<typeof EvmConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

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

export interface ResolutionResult {
  resolution: boolean;
  workers: string[];
  weights: bigint[];
  dimScores: number[];
}

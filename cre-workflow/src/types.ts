export type {
  Market,
  Reputation,
  ResolveRequest,
  ResolveResponse,
  ChallengeRequest,
  ChallengeResponse,
  WorkerInfo,
  WorkerDetermination,
  WorkerEvaluation,
  ResolutionResult,
} from "../../shared/types.js";

export interface WorkflowConfig {
  rpcUrl: string;
  contractAddress: string;
  resolverPrivateKey: string;
  marketId: number;
  workerEndpoints: Map<string, string>; // address → endpoint URL
  llmApiKey?: string;
  llmModel?: string;
  challengeTimeout?: number; // ms, default 15000
  resolveTimeout?: number; // ms, default 30000
}

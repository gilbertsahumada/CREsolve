// ─── Contract types (mirror CREsolverMarket.sol) ────────────────────────────

export interface Market {
  question: string;
  rewardPool: bigint;
  deadline: bigint;
  creator: string;
  resolved: boolean;
}

export interface Reputation {
  resQuality: number;
  srcQuality: number;
  analysisDepth: number;
  count: number;
}

// ─── A2A Protocol ────────────────────────────────────────────────────────────

export interface ResolveRequest {
  market_id: number;
  question: string;
  deadline?: number;
  context?: string;
}

export interface ResolveResponse {
  determination: boolean;
  confidence: number;
  evidence: string;
  sources: string[];
}

export interface ChallengeRequest {
  challenges: string[];
}

export interface ChallengeResponse {
  responses: string[];
}

// ─── Workflow internal ───────────────────────────────────────────────────────

export interface WorkerInfo {
  address: string;
  endpoint: string;
  stake: bigint;
  reputation: Reputation;
}

export interface WorkerDetermination extends ResolveResponse {
  workerAddress: string;
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

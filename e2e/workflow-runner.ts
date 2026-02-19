/**
 * Self-contained E2E workflow runner.
 * This is a local orchestrator that calls agents via HTTP and submits
 * resolutions on-chain using ethers.js — for E2E testing only.
 * The real CRE workflow runs in a WASM DON environment (cre-workflow/cresolver-resolution/).
 */

import { ethers } from "ethers";

// ─── ABI ─────────────────────────────────────────────────────────────────────

const CREsolverMarketABI = [
  "function getMarket(uint256 marketId) view returns (tuple(string question, uint256 rewardPool, uint256 deadline, address creator, bool resolved))",
  "function getMarketWorkers(uint256 marketId) view returns (address[])",
  "function getReputation(address worker) view returns (uint256 resQuality, uint256 srcQuality, uint256 analysisDepth, uint256 count)",
  "function stakes(uint256 marketId, address worker) view returns (uint256)",
  "function resolveMarket(uint256 marketId, address[] workers, uint256[] weights, uint8[] dimScores, bool resolution)",
  "function marketCount() view returns (uint256)",
  "function balances(address) view returns (uint256)",
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkflowConfig {
  rpcUrl: string;
  contractAddress: string;
  resolverPrivateKey: string;
  marketId: number;
  workerEndpoints: Map<string, string>;
  challengeTimeout?: number;
  resolveTimeout?: number;
}

interface Market {
  question: string;
  rewardPool: bigint;
  deadline: bigint;
  creator: string;
  resolved: boolean;
}

interface Reputation {
  resQuality: number;
  srcQuality: number;
  analysisDepth: number;
  count: number;
}

interface WorkerInfo {
  address: string;
  endpoint: string;
  stake: bigint;
  reputation: Reputation;
}

interface ResolveResponse {
  determination: boolean;
  confidence: number;
  evidence: string;
  sources: string[];
}

interface WorkerDetermination extends ResolveResponse {
  workerAddress: string;
}

interface ChallengeResult {
  workerAddress: string;
  challenges: string[];
  responses: string[];
}

interface WorkerEvaluation {
  workerAddress: string;
  qualityScore: number;
  resolutionQuality: number;
  sourceQuality: number;
  analysisDepth: number;
}

interface ResolutionResult {
  resolution: boolean;
  workers: string[];
  weights: bigint[];
  dimScores: number[];
}

export interface WorkflowResult {
  resolution: ResolutionResult;
  txHash: string;
}

// ─── Step 1: Read ────────────────────────────────────────────────────────────

async function step1Read(config: WorkflowConfig) {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const contract = new ethers.Contract(config.contractAddress, CREsolverMarketABI, provider);

  const rawMarket = await contract.getMarket(config.marketId);
  const market: Market = {
    question: rawMarket.question,
    rewardPool: rawMarket.rewardPool,
    deadline: rawMarket.deadline,
    creator: rawMarket.creator,
    resolved: rawMarket.resolved,
  };

  if (market.resolved) throw new Error(`Market ${config.marketId} is already resolved`);

  const workerAddresses: string[] = await contract.getMarketWorkers(config.marketId);
  const workers: WorkerInfo[] = [];

  for (const addr of workerAddresses) {
    const endpoint = config.workerEndpoints.get(addr.toLowerCase());
    if (!endpoint) continue;

    const stake: bigint = await contract.stakes(config.marketId, addr);
    const [resQuality, srcQuality, analysisDepth, count] = await contract.getReputation(addr);

    workers.push({
      address: addr,
      endpoint,
      stake,
      reputation: {
        resQuality: Number(resQuality),
        srcQuality: Number(srcQuality),
        analysisDepth: Number(analysisDepth),
        count: Number(count),
      },
    });
  }

  if (workers.length === 0) throw new Error("No workers with configured endpoints found");
  return { market, workers };
}

// ─── Step 2: Ask ─────────────────────────────────────────────────────────────

async function step2Ask(workers: WorkerInfo[], question: string, marketId: number, timeout = 30000) {
  const fetchWorker = async (worker: WorkerInfo): Promise<WorkerDetermination | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${worker.endpoint}/a2a/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, question }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data: ResolveResponse = await res.json();
      return { ...data, workerAddress: worker.address };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const results = await Promise.allSettled(workers.map(fetchWorker));
  const determinations = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((d): d is WorkerDetermination => d !== null);

  if (determinations.length === 0) throw new Error("No workers responded successfully");
  return determinations;
}

// ─── Step 3: Challenge ───────────────────────────────────────────────────────

function generateChallenges(det: WorkerDetermination, all: WorkerDetermination[]): string[] {
  const hasDisagreement = all.some((d) => d.determination !== det.determination);
  if (hasDisagreement) {
    return [
      `Other workers reached the opposite conclusion. What specific evidence makes you confident that the answer is ${det.determination ? "YES" : "NO"}?`,
      `Your confidence is ${(det.confidence * 100).toFixed(0)}%. What would need to change for you to reverse your determination?`,
      `Identify the weakest point in your analysis and defend it.`,
    ];
  }
  return [
    `All workers agree with your determination. Play devil's advocate — what's the strongest argument for the opposite conclusion?`,
    `What assumptions in your analysis could be wrong?`,
    `How would you respond to someone who says your sources are biased or incomplete?`,
  ];
}

async function step3Challenge(workers: WorkerInfo[], determinations: WorkerDetermination[], timeout = 15000) {
  const workerMap = new Map(workers.map((w) => [w.address, w]));

  const challengeWorker = async (det: WorkerDetermination): Promise<ChallengeResult | null> => {
    const worker = workerMap.get(det.workerAddress);
    if (!worker) return null;
    const challenges = generateChallenges(det, determinations);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${worker.endpoint}/a2a/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenges }),
        signal: controller.signal,
      });
      if (!res.ok) return { workerAddress: det.workerAddress, challenges, responses: [] };
      const data = await res.json() as { responses: string[] };
      return { workerAddress: det.workerAddress, challenges, responses: data.responses };
    } catch {
      return { workerAddress: det.workerAddress, challenges, responses: [] };
    } finally {
      clearTimeout(timer);
    }
  };

  const results = await Promise.allSettled(determinations.map(challengeWorker));
  return results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((r): r is ChallengeResult => r !== null);
}

// ─── Step 4: Evaluate ────────────────────────────────────────────────────────

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function step4Evaluate(determinations: WorkerDetermination[], challengeResults: ChallengeResult[]): WorkerEvaluation[] {
  const challengeMap = new Map(challengeResults.map((cr) => [cr.workerAddress, cr]));

  return determinations.map((det) => {
    const cr = challengeMap.get(det.workerAddress);

    // Resolution quality
    let resQ = 40;
    resQ += Math.min(30, Math.floor(det.evidence.length / 20));
    if (det.confidence > 0.95 && det.evidence.length < 200) resQ -= 10;
    else if (det.confidence >= 0.6 && det.confidence <= 0.9) resQ += 10;
    resQ += Math.min(20, det.sources.length * 5);
    const resolutionQuality = clamp(resQ);

    // Source quality
    let srcQ = 30;
    srcQ += Math.min(30, det.sources.length * 10);
    const domains = new Set(det.sources.map((s) => { try { return new URL(s).hostname; } catch { return s; } }));
    srcQ += Math.min(20, domains.size * 7);
    if (det.sources.length === 0) srcQ = 10;
    if (det.evidence.includes("http") || det.evidence.includes("source")) srcQ += 10;
    const sourceQuality = clamp(srcQ);

    // Analysis depth
    let depth = 30;
    depth += Math.min(25, Math.floor(det.evidence.length / 25));
    if (cr && cr.responses.length > 0) {
      const avgLen = cr.responses.reduce((s, r) => s + r.length, 0) / cr.responses.length;
      depth += Math.min(25, Math.floor(avgLen / 15));
      if (cr.responses.length >= cr.challenges.length) depth += 10;
    }
    const analysisDepth = clamp(depth);

    const qualityScore = Math.round(resolutionQuality * 0.4 + sourceQuality * 0.3 + analysisDepth * 0.3);

    return { workerAddress: det.workerAddress, qualityScore, resolutionQuality, sourceQuality, analysisDepth };
  });
}

// ─── Step 5: Resolve ─────────────────────────────────────────────────────────

function step5Resolve(determinations: WorkerDetermination[], evaluations: WorkerEvaluation[], workers: WorkerInfo[]): ResolutionResult {
  const evalMap = new Map(evaluations.map((e) => [e.workerAddress, e]));
  const workerMap = new Map(workers.map((w) => [w.address, w]));

  let yesWeight = 0;
  let noWeight = 0;

  for (const det of determinations) {
    const ev = evalMap.get(det.workerAddress);
    const w = workerMap.get(det.workerAddress);
    if (!ev || !w) continue;
    const repFactor = w.reputation.count > 0
      ? (w.reputation.resQuality + w.reputation.srcQuality + w.reputation.analysisDepth) / 3 / 100 + 0.5
      : 1.0;
    const voteWeight = ev.qualityScore * repFactor;
    if (det.determination) yesWeight += voteWeight;
    else noWeight += voteWeight;
  }

  const resolution = yesWeight >= noWeight;

  const resultWorkers: string[] = [];
  const resultWeights: bigint[] = [];
  const resultDimScores: number[] = [];

  for (const det of determinations) {
    const ev = evalMap.get(det.workerAddress);
    const w = workerMap.get(det.workerAddress);
    if (!ev || !w) continue;
    const correctnessMult = det.determination === resolution ? 200 : 50;
    const repFactor = w.reputation.count > 0
      ? (w.reputation.resQuality + w.reputation.srcQuality + w.reputation.analysisDepth) / 3 / 100 + 0.5
      : 1.0;
    const weight = Math.round(ev.qualityScore * correctnessMult * repFactor);
    resultWorkers.push(det.workerAddress);
    resultWeights.push(BigInt(weight));
    resultDimScores.push(ev.resolutionQuality, ev.sourceQuality, ev.analysisDepth);
  }

  return { resolution, workers: resultWorkers, weights: resultWeights, dimScores: resultDimScores };
}

// ─── Step 6: Write ───────────────────────────────────────────────────────────

async function step6Write(config: WorkflowConfig, result: ResolutionResult): Promise<string> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const signer = new ethers.Wallet(config.resolverPrivateKey, provider);
  const contract = new ethers.Contract(config.contractAddress, CREsolverMarketABI, signer);

  const dimScoresU8 = result.dimScores.map((s) => Math.max(0, Math.min(100, Math.round(s))));

  const tx = await contract.resolveMarket(
    config.marketId,
    result.workers,
    result.weights,
    dimScoresU8,
    result.resolution,
  );
  await tx.wait();
  return tx.hash;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runResolutionWorkflow(config: WorkflowConfig): Promise<WorkflowResult> {
  const { market, workers } = await step1Read(config);
  const determinations = await step2Ask(workers, market.question, config.marketId, config.resolveTimeout ?? 30000);
  const challengeResults = await step3Challenge(workers, determinations, config.challengeTimeout ?? 15000);
  const evaluations = step4Evaluate(determinations, challengeResults);
  const resolution = step5Resolve(determinations, evaluations, workers);
  const txHash = await step6Write(config, resolution);
  return { resolution, txHash };
}

import type { WorkerDetermination, WorkerEvaluation } from "./types.js";

interface ChallengeResult {
  workerAddress: string;
  challenges: string[];
  responses: string[];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function scoreResolutionQuality(det: WorkerDetermination): number {
  let score = 40; // base

  // Evidence length contributes up to 30 points
  const evidenceLen = det.evidence.length;
  score += Math.min(30, Math.floor(evidenceLen / 20));

  // Confidence calibration: extreme confidence (>0.95 or <0.05) without
  // long evidence is penalized; well-calibrated mid-range is rewarded
  if (det.confidence > 0.95 && evidenceLen < 200) {
    score -= 10; // overconfident with little evidence
  } else if (det.confidence >= 0.6 && det.confidence <= 0.9) {
    score += 10; // well-calibrated
  }

  // Sources count: up to 20 points
  score += Math.min(20, det.sources.length * 5);

  return clamp(score);
}

function scoreSourceQuality(det: WorkerDetermination): number {
  let score = 30; // base

  // Number of sources
  score += Math.min(30, det.sources.length * 10);

  // Source diversity: unique domains
  const domains = new Set(
    det.sources.map((s) => {
      try {
        return new URL(s).hostname;
      } catch {
        return s;
      }
    }),
  );
  score += Math.min(20, domains.size * 7);

  // Penalize if no sources
  if (det.sources.length === 0) score = 10;

  // Bonus for having evidence that references sources
  if (det.evidence.includes("http") || det.evidence.includes("source")) {
    score += 10;
  }

  return clamp(score);
}

function scoreAnalysisDepth(
  det: WorkerDetermination,
  challengeResult?: ChallengeResult,
): number {
  let score = 30; // base

  // Evidence depth
  score += Math.min(25, Math.floor(det.evidence.length / 25));

  // Challenge response quality
  if (challengeResult && challengeResult.responses.length > 0) {
    const avgResponseLen =
      challengeResult.responses.reduce((sum, r) => sum + r.length, 0) /
      challengeResult.responses.length;
    score += Math.min(25, Math.floor(avgResponseLen / 15));

    // Bonus for responding to all challenges
    if (challengeResult.responses.length >= challengeResult.challenges.length) {
      score += 10;
    }
  }

  return clamp(score);
}

export function step4Evaluate(
  determinations: WorkerDetermination[],
  challengeResults: ChallengeResult[],
): WorkerEvaluation[] {
  console.log(
    `[Step 4 EVALUATE] Scoring ${determinations.length} workers...`,
  );

  const challengeMap = new Map(
    challengeResults.map((cr) => [cr.workerAddress, cr]),
  );

  const evaluations = determinations.map((det) => {
    const challengeResult = challengeMap.get(det.workerAddress);

    const resolutionQuality = scoreResolutionQuality(det);
    const sourceQuality = scoreSourceQuality(det);
    const analysisDepth = scoreAnalysisDepth(det, challengeResult);

    const qualityScore = Math.round(
      resolutionQuality * 0.4 + sourceQuality * 0.3 + analysisDepth * 0.3,
    );

    console.log(
      `  ${det.workerAddress.slice(0, 10)}...: quality=${qualityScore} (res=${resolutionQuality} src=${sourceQuality} depth=${analysisDepth})`,
    );

    return {
      workerAddress: det.workerAddress,
      qualityScore,
      resolutionQuality,
      sourceQuality,
      analysisDepth,
    };
  });

  return evaluations;
}

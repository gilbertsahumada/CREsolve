import type {
  WorkerDetermination,
  WorkerEvaluation,
  ChallengeResult,
  WorkerData,
  ResolutionResult,
} from "./types.js";

// ─── Scoring (ported from legacy step4-evaluate.ts) ──────────────────────────

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function scoreResolutionQuality(det: WorkerDetermination): number {
  let score = 40;

  const evidenceLen = det.evidence.length;
  score += Math.min(30, Math.floor(evidenceLen / 20));

  if (det.confidence > 0.95 && evidenceLen < 200) {
    score -= 10;
  } else if (det.confidence >= 0.6 && det.confidence <= 0.9) {
    score += 10;
  }

  score += Math.min(20, det.sources.length * 5);

  return clamp(score);
}

function scoreSourceQuality(det: WorkerDetermination): number {
  let score = 30;

  score += Math.min(30, det.sources.length * 10);

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

  if (det.sources.length === 0) score = 10;

  if (det.evidence.includes("http") || det.evidence.includes("source")) {
    score += 10;
  }

  return clamp(score);
}

function scoreAnalysisDepth(
  det: WorkerDetermination,
  challengeResult?: ChallengeResult,
): number {
  let score = 30;

  score += Math.min(25, Math.floor(det.evidence.length / 25));

  if (challengeResult && challengeResult.responses.length > 0) {
    const avgResponseLen =
      challengeResult.responses.reduce((sum, r) => sum + r.length, 0) /
      challengeResult.responses.length;
    score += Math.min(25, Math.floor(avgResponseLen / 15));

    if (
      challengeResult.responses.length >= challengeResult.challenges.length
    ) {
      score += 10;
    }
  }

  return clamp(score);
}

export function evaluateWorkers(
  determinations: WorkerDetermination[],
  challengeResults: ChallengeResult[],
): WorkerEvaluation[] {
  const challengeMap = new Map(
    challengeResults.map((cr) => [cr.workerAddress, cr]),
  );

  return determinations.map((det) => {
    const challengeResult = challengeMap.get(det.workerAddress);

    const resolutionQuality = scoreResolutionQuality(det);
    const sourceQuality = scoreSourceQuality(det);
    const analysisDepth = scoreAnalysisDepth(det, challengeResult);

    const qualityScore = Math.round(
      resolutionQuality * 0.4 + sourceQuality * 0.3 + analysisDepth * 0.3,
    );

    return {
      workerAddress: det.workerAddress,
      qualityScore,
      resolutionQuality,
      sourceQuality,
      analysisDepth,
    };
  });
}

// ─── Resolution (ported from legacy step5-resolve.ts) ────────────────────────

export function computeResolution(
  determinations: WorkerDetermination[],
  evaluations: WorkerEvaluation[],
  workers: WorkerData[],
): ResolutionResult {
  const evalMap = new Map(evaluations.map((e) => [e.workerAddress, e]));
  const workerMap = new Map(workers.map((w) => [w.address, w]));

  // Weighted majority vote
  let yesWeight = 0;
  let noWeight = 0;

  for (const det of determinations) {
    const ev = evalMap.get(det.workerAddress);
    const w = workerMap.get(det.workerAddress);
    if (!ev || !w) continue;

    const repFactor =
      w.reputation.count > 0
        ? (w.reputation.resQuality +
            w.reputation.srcQuality +
            w.reputation.analysisDepth) /
            3 /
            100 +
          0.5
        : 1.0;

    const voteWeight = ev.qualityScore * repFactor;
    if (det.determination) {
      yesWeight += voteWeight;
    } else {
      noWeight += voteWeight;
    }
  }

  const resolution = yesWeight >= noWeight;

  // Blinded weights for on-chain distribution
  const resultWorkers: string[] = [];
  const resultWeights: bigint[] = [];
  const resultDimScores: number[] = [];

  for (const det of determinations) {
    const ev = evalMap.get(det.workerAddress);
    const w = workerMap.get(det.workerAddress);
    if (!ev || !w) continue;

    const correctnessMult = det.determination === resolution ? 200 : 50;
    const repFactor =
      w.reputation.count > 0
        ? (w.reputation.resQuality +
            w.reputation.srcQuality +
            w.reputation.analysisDepth) /
            3 /
            100 +
          0.5
        : 1.0;

    const weight = Math.round(ev.qualityScore * correctnessMult * repFactor);

    resultWorkers.push(det.workerAddress);
    resultWeights.push(BigInt(weight));
    resultDimScores.push(
      ev.resolutionQuality,
      ev.sourceQuality,
      ev.analysisDepth,
    );
  }

  return {
    resolution,
    workers: resultWorkers,
    weights: resultWeights,
    dimScores: resultDimScores,
  };
}

// ─── Challenge generation (ported from legacy step3-challenge.ts) ────────────

export function generateChallenges(
  determination: WorkerDetermination,
  allDeterminations: WorkerDetermination[],
): string[] {
  const hasDisagreement = allDeterminations.some(
    (d) => d.determination !== determination.determination,
  );

  if (hasDisagreement) {
    return [
      `Other workers reached the opposite conclusion. What specific evidence makes you confident that the answer is ${determination.determination ? "YES" : "NO"}?`,
      `Your confidence is ${(determination.confidence * 100).toFixed(0)}%. What would need to change for you to reverse your determination?`,
      `Identify the weakest point in your analysis and defend it.`,
    ];
  }

  return [
    `All workers agree with your determination. Play devil's advocate — what's the strongest argument for the opposite conclusion?`,
    `What assumptions in your analysis could be wrong?`,
    `How would you respond to someone who says your sources are biased or incomplete?`,
  ];
}

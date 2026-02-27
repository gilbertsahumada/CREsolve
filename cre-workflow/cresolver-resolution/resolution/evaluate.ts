import type {
  WorkerDetermination,
  WorkerEvaluation,
  WorkerData,
  ResolutionResult,
} from "../types.js";

// ─── Resolution ─────────────────────────────────────────────────────────────

export function computeResolution(
  determinations: WorkerDetermination[],
  evaluations: WorkerEvaluation[],
  workers: WorkerData[],
  allOnChainWorkers: string[],
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
  // Workers that responded get their computed weight; non-responsive workers get 0
  const resultWorkers: string[] = [];
  const resultWeights: bigint[] = [];
  const resultDimScores: number[] = [];
  const includedSet = new Set<string>();

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
    includedSet.add(det.workerAddress.toLowerCase());
  }

  // Include non-responsive workers with weight=0 and dimScores=[0,0,0]
  // so the report matches the on-chain worker set exactly.
  // These workers receive no reward for failing to respond.
  for (const addr of allOnChainWorkers) {
    if (!includedSet.has(addr.toLowerCase())) {
      resultWorkers.push(addr);
      resultWeights.push(0n);
      resultDimScores.push(0, 0, 0);
    }
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

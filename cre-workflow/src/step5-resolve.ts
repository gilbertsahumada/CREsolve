import type {
  WorkerDetermination,
  WorkerEvaluation,
  WorkerInfo,
  ResolutionResult,
} from "./types.js";

export function step5Resolve(
  determinations: WorkerDetermination[],
  evaluations: WorkerEvaluation[],
  workers: WorkerInfo[],
): ResolutionResult {
  console.log("[Step 5 RESOLVE] Computing weighted majority vote...");

  const evalMap = new Map(evaluations.map((e) => [e.workerAddress, e]));
  const workerMap = new Map(workers.map((w) => [w.address, w]));

  // ── Weighted majority vote ────────────────────────────────────────────
  // voteWeight = qualityScore × reputationFactor
  let yesWeight = 0;
  let noWeight = 0;

  for (const det of determinations) {
    const ev = evalMap.get(det.workerAddress);
    const w = workerMap.get(det.workerAddress);
    if (!ev || !w) continue;

    const repFactor =
      w.reputation.count > 0
        ? (w.reputation.resQuality + w.reputation.srcQuality + w.reputation.analysisDepth) / 3 / 100 + 0.5
        : 1.0; // no reputation = neutral factor

    const voteWeight = ev.qualityScore * repFactor;
    if (det.determination) {
      yesWeight += voteWeight;
    } else {
      noWeight += voteWeight;
    }
  }

  const resolution = yesWeight >= noWeight;
  console.log(
    `  Vote: YES=${yesWeight.toFixed(1)} vs NO=${noWeight.toFixed(1)} → ${resolution ? "YES" : "NO"}`,
  );

  // ── Blinded weights for on-chain distribution ─────────────────────────
  // weight = quality × correctnessMult × reputationFactor
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
        ? (w.reputation.resQuality + w.reputation.srcQuality + w.reputation.analysisDepth) / 3 / 100 + 0.5
        : 1.0;

    const weight = Math.round(ev.qualityScore * correctnessMult * repFactor);

    resultWorkers.push(det.workerAddress);
    resultWeights.push(BigInt(weight));
    // Pack 3 dimensions per worker: resQ, srcQ, depth (clamped to 0-100 for uint8)
    resultDimScores.push(ev.resolutionQuality, ev.sourceQuality, ev.analysisDepth);
  }

  console.log(
    `  Weights: [${resultWeights.map((w) => w.toString()).join(", ")}]`,
  );

  return {
    resolution,
    workers: resultWorkers,
    weights: resultWeights,
    dimScores: resultDimScores,
  };
}

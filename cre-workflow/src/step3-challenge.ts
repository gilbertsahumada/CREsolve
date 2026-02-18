import type {
  WorkerInfo,
  WorkerDetermination,
  ChallengeResponse,
} from "./types.js";

interface ChallengeResult {
  workerAddress: string;
  challenges: string[];
  responses: string[];
}

function generateChallenges(
  determination: WorkerDetermination,
  allDeterminations: WorkerDetermination[],
): string[] {
  const hasDisagreement = allDeterminations.some(
    (d) => d.determination !== determination.determination,
  );

  if (hasDisagreement) {
    // Specific challenges when workers disagree
    return [
      `Other workers reached the opposite conclusion. What specific evidence makes you confident that the answer is ${determination.determination ? "YES" : "NO"}?`,
      `Your confidence is ${(determination.confidence * 100).toFixed(0)}%. What would need to change for you to reverse your determination?`,
      `Identify the weakest point in your analysis and defend it.`,
    ];
  }

  // Devil's advocate when all agree
  return [
    `All workers agree with your determination. Play devil's advocate — what's the strongest argument for the opposite conclusion?`,
    `What assumptions in your analysis could be wrong?`,
    `How would you respond to someone who says your sources are biased or incomplete?`,
  ];
}

export async function step3Challenge(
  workers: WorkerInfo[],
  determinations: WorkerDetermination[],
  timeout = 15000,
): Promise<ChallengeResult[]> {
  console.log(
    `[Step 3 CHALLENGE] Challenging ${determinations.length} workers...`,
  );

  const workerMap = new Map(workers.map((w) => [w.address, w]));

  const challengeWorker = async (
    det: WorkerDetermination,
  ): Promise<ChallengeResult | null> => {
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

      if (!res.ok) {
        console.warn(
          `  [FAIL] Challenge to ${worker.address}: HTTP ${res.status}`,
        );
        return { workerAddress: det.workerAddress, challenges, responses: [] };
      }

      const data: ChallengeResponse = await res.json();
      console.log(
        `  [OK] ${worker.address.slice(0, 10)}... defended ${data.responses.length} challenges`,
      );
      return {
        workerAddress: det.workerAddress,
        challenges,
        responses: data.responses,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.warn(`  [FAIL] Challenge to ${worker.address}: ${msg}`);
      return { workerAddress: det.workerAddress, challenges, responses: [] };
    } finally {
      clearTimeout(timer);
    }
  };

  const results = await Promise.allSettled(
    determinations.map(challengeWorker),
  );
  return results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((r): r is ChallengeResult => r !== null);
}

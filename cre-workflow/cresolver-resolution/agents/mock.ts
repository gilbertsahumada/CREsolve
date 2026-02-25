import type {
  WorkerData,
  WorkerDetermination,
  ChallengeResult,
} from "../types";
import { generateChallenges } from "../resolution/evaluate";

// ─── Deterministic seed from address ────────────────────────────────────────

function seedFromAddress(address: string): number {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = ((hash << 5) - hash + address.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function seededFloat(seed: number, index: number): number {
  // Simple deterministic hash mixing
  let h = seed ^ (index * 2654435761);
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return (Math.abs(h) % 10000) / 10000;
}

// ─── Mock evidence templates ────────────────────────────────────────────────

const YES_EVIDENCE = [
  "Multiple independent sources confirm this outcome. Official records and primary data sources consistently support an affirmative determination.",
  "On-chain data and verified external feeds indicate the condition has been met. Cross-referenced with three independent APIs.",
  "Analysis of publicly available data from official channels strongly supports a YES determination. Historical patterns align with current observations.",
];

const NO_EVIDENCE = [
  "Available evidence does not meet the threshold for an affirmative determination. Key indicators point to the condition remaining unmet.",
  "Cross-referencing multiple data sources reveals insufficient support. Primary metrics fall below the required threshold.",
  "Despite some positive signals, the weight of evidence — including official records — points to a negative determination.",
];

const SOURCES = [
  "https://api.example.com/data/v1",
  "https://oracle.example.com/feed/latest",
  "https://registry.example.org/records",
  "https://stats.example.io/metrics",
  "https://archive.example.com/historical",
];

const CHALLENGE_RESPONSES = [
  "The evidence I cited is drawn from primary sources with verifiable timestamps. While I acknowledge the limitation you raise, the core data points remain robust.",
  "I have considered the counterargument carefully. My confidence reflects the balance of evidence, not certainty. The strongest counter-evidence would be a direct official statement contradicting the data.",
  "The weakest point in my analysis is the reliance on a single primary feed for the most recent data point. However, historical consistency across multiple sources provides additional confidence.",
];

// ─── Mock generators ────────────────────────────────────────────────────────

export function generateMockDeterminations(
  workers: WorkerData[],
  marketId: number,
  question: string,
): WorkerDetermination[] {
  return workers.map((worker, i) => {
    const seed = seedFromAddress(worker.address);
    const f = seededFloat(seed, marketId);

    // Ensure at least one YES and one NO when there are 2+ workers
    let determination: boolean;
    if (workers.length >= 2 && i === 0) {
      determination = true;
    } else if (workers.length >= 2 && i === 1) {
      determination = false;
    } else {
      determination = f > 0.4;
    }

    const confidence = 0.65 + seededFloat(seed, marketId + 100) * 0.3; // 0.65–0.95
    const evidencePool = determination ? YES_EVIDENCE : NO_EVIDENCE;
    const evidenceIdx = seed % evidencePool.length;

    const sourceCount = 2 + (seed % 3); // 2–4 sources
    const workerSources: string[] = [];
    for (let s = 0; s < sourceCount; s++) {
      workerSources.push(SOURCES[(seed + s) % SOURCES.length]);
    }

    return {
      workerAddress: worker.address,
      determination,
      confidence: Math.round(confidence * 100) / 100,
      evidence: evidencePool[evidenceIdx],
      sources: workerSources,
    };
  });
}

export function generateMockChallengeResults(
  workers: WorkerData[],
  determinations: WorkerDetermination[],
): ChallengeResult[] {
  const results: ChallengeResult[] = [];

  for (const det of determinations) {
    const challenges = generateChallenges(det, determinations);
    const seed = seedFromAddress(det.workerAddress);

    const responses = challenges.map((_, j) => {
      const idx = (seed + j) % CHALLENGE_RESPONSES.length;
      return CHALLENGE_RESPONSES[idx];
    });

    results.push({
      workerAddress: det.workerAddress,
      challenges,
      responses,
    });
  }

  return results;
}

import {
  HTTPClient,
  type Runtime,
  type NodeRuntime,
} from "@chainlink/cre-sdk";
import { json, ok } from "@chainlink/cre-sdk";
import { consensusIdenticalAggregation } from "@chainlink/cre-sdk";
import type {
  Config,
  WorkerData,
  WorkerDetermination,
  AgentResolveResponse,
  AgentChallengeResponse,
  ChallengeResult,
} from "./types";
import { generateChallenges } from "./evaluate";

const httpClient = new HTTPClient();

/** Encode a string as base64 for protobuf bytes JSON fields */
function toBase64(str: string): string {
  // Use Buffer if available (Node.js), otherwise use btoa
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf-8").toString("base64");
  }
  return btoa(str);
}

// ─── Query all agents for determinations ─────────────────────────────────────

export function queryAllAgents(
  runtime: Runtime<Config>,
  workers: WorkerData[],
  marketId: number,
  question: string,
): WorkerDetermination[] {
  const determinations: WorkerDetermination[] = [];

  for (const worker of workers) {
    try {
      const bodyStr = JSON.stringify({
        market_id: marketId,
        question,
      });

      // Each node independently queries agents; use runInNodeMode with
      // consensusIdenticalAggregation to ensure all nodes agree on results
      const queryFn = runtime.runInNodeMode(
        (nodeRuntime: NodeRuntime<Config>) => {
          const response = httpClient
            .sendRequest(nodeRuntime, {
              url: `${worker.endpoint}/a2a/resolve`,
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: toBase64(bodyStr),
              timeout: "30s",
              cacheSettings: { store: true, maxAge: "600s" },
            })
            .result();

          if (!ok(response)) {
            return null;
          }

          const data = json(response) as AgentResolveResponse;
          return {
            determination: data.determination,
            confidence: data.confidence,
            evidence: data.evidence,
            sources: data.sources,
            workerAddress: worker.address,
          };
        },
        consensusIdenticalAggregation<WorkerDetermination | null>(),
      );

      const result = queryFn().result();
      if (result) {
        determinations.push(result);
        runtime.log(
          `Worker ${worker.address.slice(0, 10)}...: ${result.determination ? "YES" : "NO"} (${(result.confidence * 100).toFixed(0)}%)`,
        );
      }
    } catch {
      runtime.log(`Worker ${worker.address.slice(0, 10)}... failed to respond`);
    }
  }

  if (determinations.length === 0) {
    throw new Error("No workers responded successfully");
  }
  if (determinations.length !== workers.length) {
    const responded = new Set(
      determinations.map((d) => d.workerAddress.toLowerCase()),
    );
    const missing = workers
      .filter((w) => !responded.has(w.address.toLowerCase()))
      .map((w) => w.address);
    throw new Error(
      `Missing determinations from ${missing.length} worker(s): ${missing.join(", ")}`,
    );
  }

  runtime.log(
    `${determinations.length}/${workers.length} workers responded`,
  );
  return determinations;
}

// ─── Challenge all agents ────────────────────────────────────────────────────

export function challengeAllAgents(
  runtime: Runtime<Config>,
  workers: WorkerData[],
  determinations: WorkerDetermination[],
): ChallengeResult[] {
  const workerMap = new Map(workers.map((w) => [w.address, w]));
  const challengeResults: ChallengeResult[] = [];

  for (const det of determinations) {
    const worker = workerMap.get(det.workerAddress);
    if (!worker) continue;

    const challenges = generateChallenges(det, determinations);

    try {
      const bodyStr = JSON.stringify({ challenges });

      const challengeFn = runtime.runInNodeMode(
        (nodeRuntime: NodeRuntime<Config>) => {
          const response = httpClient
            .sendRequest(nodeRuntime, {
              url: `${worker.endpoint}/a2a/challenge`,
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: toBase64(bodyStr),
              timeout: "15s",
              cacheSettings: { store: true, maxAge: "600s" },
            })
            .result();

          if (!ok(response)) {
            return { responses: [] as string[] };
          }

          const data = json(response) as AgentChallengeResponse;
          return { responses: data.responses };
        },
        consensusIdenticalAggregation<{ responses: string[] }>(),
      );

      const result = challengeFn().result();
      challengeResults.push({
        workerAddress: det.workerAddress,
        challenges,
        responses: result.responses,
      });

      runtime.log(
        `${worker.address.slice(0, 10)}... defended ${result.responses.length} challenges`,
      );
    } catch {
      challengeResults.push({
        workerAddress: det.workerAddress,
        challenges,
        responses: [],
      });
    }
  }

  return challengeResults;
}

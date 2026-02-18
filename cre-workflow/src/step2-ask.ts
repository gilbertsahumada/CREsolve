import type { WorkerInfo, WorkerDetermination, ResolveResponse } from "./types.js";

export async function step2Ask(
  workers: WorkerInfo[],
  question: string,
  marketId: number,
  timeout = 30000,
): Promise<WorkerDetermination[]> {
  console.log(
    `[Step 2 ASK] Querying ${workers.length} workers (timeout: ${timeout}ms)...`,
  );

  const fetchWithTimeout = async (
    worker: WorkerInfo,
  ): Promise<WorkerDetermination | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`${worker.endpoint}/a2a/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, question }),
        signal: controller.signal,
      });

      if (!res.ok) {
        console.warn(
          `  [FAIL] Worker ${worker.address}: HTTP ${res.status}`,
        );
        return null;
      }

      const data: ResolveResponse = await res.json();
      console.log(
        `  [OK] Worker ${worker.address.slice(0, 10)}...: ${data.determination ? "YES" : "NO"} (${(data.confidence * 100).toFixed(0)}%)`,
      );
      return { ...data, workerAddress: worker.address };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.warn(`  [FAIL] Worker ${worker.address}: ${msg}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const results = await Promise.allSettled(workers.map(fetchWithTimeout));
  const determinations = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((d): d is WorkerDetermination => d !== null);

  if (determinations.length === 0) {
    throw new Error("No workers responded successfully");
  }

  console.log(
    `  ${determinations.length}/${workers.length} workers responded`,
  );
  return determinations;
}

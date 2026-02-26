import {
  HTTPClient,
  type Runtime,
  type NodeRuntime,
} from "@chainlink/cre-sdk";
import { ok } from "@chainlink/cre-sdk";
import { consensusIdenticalAggregation } from "@chainlink/cre-sdk";
import type { Config, WorkerData, DiscardedWorker } from "../types";

// Regular HTTPClient for health checks — endpoints are public (ERC-8004 tokenURI).
const httpClient = new HTTPClient();

export interface EndpointValidationResult {
  reachable: WorkerData[];
  unreachable: DiscardedWorker[];
}

export function validateEndpoints(
  runtime: Runtime<Config>,
  workers: WorkerData[],
): EndpointValidationResult {
  const reachable: WorkerData[] = [];
  const unreachable: DiscardedWorker[] = [];

  for (const worker of workers) {
    try {
      const checkFn = runtime.runInNodeMode(
        (nodeRuntime: NodeRuntime<Config>) => {
          const response = httpClient
            .sendRequest(nodeRuntime, {
              url: `${worker.endpoint}/.well-known/agent.json`,
              method: "GET",
              headers: {},
              timeout: "10s",
              cacheSettings: { store: true, maxAge: "300s" },
            })
            .result();

          return { isOk: ok(response), statusCode: response.statusCode };
        },
        consensusIdenticalAggregation<{ isOk: boolean; statusCode: number }>(),
      );

      const result = checkFn().result();

      if (result.isOk) {
        reachable.push(worker);
      } else {
        runtime.log(
          `Worker ${worker.address.slice(0, 10)}... endpoint unreachable (status ${result.statusCode})`,
        );
        unreachable.push({
          address: worker.address,
          reason: "endpoint_unreachable",
          detail: `GET /.well-known/agent.json returned status ${result.statusCode}`,
        });
      }
    } catch {
      runtime.log(
        `Worker ${worker.address.slice(0, 10)}... endpoint unreachable (network error)`,
      );
      unreachable.push({
        address: worker.address,
        reason: "endpoint_unreachable",
        detail: "network error or timeout reaching /.well-known/agent.json",
      });
    }
  }

  runtime.log(
    `Endpoint validation: ${reachable.length} reachable, ${unreachable.length} unreachable`,
  );

  return { reachable, unreachable };
}

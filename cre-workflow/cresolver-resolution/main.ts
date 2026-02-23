import {
  EVMClient,
  HTTPCapability,
  bytesToBigint,
  handler,
  Runner,
  type EVMLog,
  type HTTPPayload,
  type Runtime,
} from "@chainlink/cre-sdk";
import { keccak256, toBytes, type Address } from "viem";

import { ConfigSchema, type Config } from "./types";
import { readMarketWorkers, readMarketQuestion, submitResolution } from "./evm";
import { queryAllAgents, challengeAllAgents } from "./agents";
import { evaluateWorkers, computeResolution } from "./evaluate";

// ─── Event signature for the EVM Log Trigger ─────────────────────────────────

// keccak256("ResolutionRequested(uint256,string)")
const RESOLUTION_REQUESTED_TOPIC = keccak256(
  toBytes("ResolutionRequested(uint256,string)"),
);

function parseChainSelector(value: Config["evms"][number]["chain_selector"]): bigint {
  return BigInt(typeof value === "string" ? value : value);
}

function marketIdFromLog(log: EVMLog): number {
  if (log.topics.length < 2 || !log.topics[1]) {
    throw new Error(
      `ResolutionRequested log missing indexed marketId topic (topics=${log.topics.length})`,
    );
  }
  const marketIdTopic = log.topics[1];
  return Number(bytesToBigint(marketIdTopic));
}

// ─── Core resolution logic (shared by both triggers) ─────────────────────────

function resolveMarket(
  runtime: Runtime<Config>,
  marketId: number,
): void {
  const evm = runtime.config.evms[0];
  const evmClient = new EVMClient(parseChainSelector(evm.chain_selector));

  runtime.log(`Starting resolution for market ${marketId}`);

  // Step 1: Read market data and worker info from chain
  const question = readMarketQuestion(runtime, evmClient, marketId);
  const workers = readMarketWorkers(runtime, evmClient, marketId);

  // Step 2: Query all agents for their determinations
  const determinations = queryAllAgents(runtime, workers, marketId, question);

  // Step 3: Challenge workers
  const challengeResults = challengeAllAgents(runtime, workers, determinations);

  // Step 4: Evaluate worker quality
  const evaluations = evaluateWorkers(determinations, challengeResults);

  // Step 5: Compute weighted majority vote + blinded weights
  const resolution = computeResolution(determinations, evaluations, workers);

  // Step 6: Submit resolution on-chain via signed report
  submitResolution(runtime, evmClient, marketId, resolution);

  runtime.log(
    `Market ${marketId} resolved: ${resolution.resolution ? "YES" : "NO"} with ${resolution.workers.length} workers`,
  );
}

// ─── Trigger handlers ─────────────────────────────────────────────────────────

const onLogTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  const marketId = marketIdFromLog(log);
  runtime.log(`EVM Log Trigger: ResolutionRequested for market ${marketId}`);
  //resolveMarket(runtime, marketId);
  return "Only logging for now, resolution logic is commented out for testing";
};

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload) => {
  const inputStr = new TextDecoder().decode(payload.input);
  let input: { market_id?: number };
  try {
    input = JSON.parse(inputStr) as { market_id?: number };
  } catch {
    throw new Error("HTTP payload must be valid JSON");
  }
  const rawMarketId = input.market_id;

  if (!Number.isInteger(rawMarketId) || (rawMarketId as number) < 0) {
    throw new Error("HTTP payload must include integer field market_id");
  }

  const marketId = rawMarketId as number;
  runtime.log(`HTTP Trigger: Resolution requested for market ${marketId}`);
  //resolveMarket(runtime, marketId);
  return {};
};

// ─── Workflow wiring ──────────────────────────────────────────────────────────

function initWorkflow(config: Config) {
  const evm = config.evms[0];
  const chainSelector = parseChainSelector(evm.chain_selector);
  const evmClient = new EVMClient(chainSelector);
  const marketAddr = evm.market_address as Address;

  // ── Trigger 1: EVM Log Trigger ──────────────────────────────────────────
  // Listens for ResolutionRequested(uint256,string) events on the market contract
  const evmLogTrigger = evmClient.logTrigger({
    addresses: [marketAddr],
    //topics: [
    //  { values: [RESOLUTION_REQUESTED_TOPIC] }, // topic0: event signature
    //],
  });

  // ── Trigger 2: HTTP Trigger ─────────────────────────────────────────────
  // Accepts external requests to trigger resolution manually
  //const httpTrigger = new HTTPCapability().trigger({});

  return [
    handler(evmLogTrigger, onLogTrigger),
    //handler(httpTrigger, onHttpTrigger),
  ];
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function main() {
  const runner = await Runner.newRunner<Config>({
    configSchema: ConfigSchema,
  });
  await runner.run(initWorkflow);
}

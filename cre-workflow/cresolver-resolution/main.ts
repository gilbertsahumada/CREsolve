import {
  EVMClient,
  HTTPCapability,
  handler,
  type Runtime,
  type EVMLog,
  type HTTPPayload,
} from "@chainlink/cre-sdk";
import { Runner } from "@chainlink/cre-sdk";
import { hexToBytes, bytesToBigint, bytesToHex } from "@chainlink/cre-sdk";
import { decodeAbiParameters, keccak256, toBytes, type Address } from "viem";

import { ConfigSchema, type Config } from "./types.js";
import { readMarketWorkers, readMarketQuestion, submitResolution } from "./evm.js";
import { queryAllAgents, challengeAllAgents } from "./agents.js";
import { evaluateWorkers, computeResolution } from "./evaluate.js";

// ─── Event signature for the EVM Log Trigger ─────────────────────────────────

// keccak256("ResolutionRequested(uint256,string)")
const RESOLUTION_REQUESTED_TOPIC = keccak256(
  toBytes("ResolutionRequested(uint256,string)"),
);

function parseChainSelector(value: Config["evms"][number]["chain_selector"]): bigint {
  return BigInt(typeof value === "string" ? value : value);
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

// ─── Workflow initialization ─────────────────────────────────────────────────

function initWorkflow(config: Config) {
  const evm = config.evms[0];
  const chainSelector = parseChainSelector(evm.chain_selector);
  const evmClient = new EVMClient(chainSelector);
  const marketAddr = evm.market_address as Address;

  // ── Trigger 1: EVM Log Trigger ──────────────────────────────────────────
  // Listens for ResolutionRequested(uint256,string) events on the market contract
  const evmLogTrigger = evmClient.logTrigger({
    addresses: [marketAddr],
    topics: [
      { values: [RESOLUTION_REQUESTED_TOPIC] }, // topic0: event signature
    ],
  });

  const handleEvmLogTrigger = (
    runtime: Runtime<Config>,
    log: EVMLog,
  ) => {
    // Extract marketId from the first indexed topic (topic1)
    const marketIdTopic = log.topics[1];
    const marketId = marketIdTopic
      ? Number(bytesToBigint(marketIdTopic))
      : 0;

    runtime.log(`EVM Log Trigger: ResolutionRequested for market ${marketId}`);
    resolveMarket(runtime, marketId);
    return [
      handler(
        evmClient.logTrigger({
          addresses: [config.evms[0].market_address as Address],
        }),
        onLogTrigger,
      )
    ];
  };

  // ── Trigger 2: HTTP Trigger ─────────────────────────────────────────────
  // Accepts external POST requests to trigger resolution manually
  const httpTrigger = new HTTPCapability().trigger({});

  const handleHttpTrigger = (
    runtime: Runtime<Config>,
    payload: HTTPPayload,
  ) => {
    // Parse the JSON input from the HTTP trigger payload
    const inputStr = new TextDecoder().decode(payload.input);
    const input = JSON.parse(inputStr) as { market_id: number };
    const marketId = input.market_id;

    runtime.log(`HTTP Trigger: Resolution requested for market ${marketId}`);
    resolveMarket(runtime, marketId);
    return [
      handler(
        evmClient.logTrigger({
          addresses: [config.evms[0].market_address as Address],
        }),
        onLogTrigger,
      )
    ];
  };

  return [
    handler(evmLogTrigger, handleEvmLogTrigger),
    handler(httpTrigger, handleHttpTrigger),
  ];
}

const onLogTrigger = (runtime: Runtime<Config>, log: EVMLog) => {
  runtime.log('EVM Log Trigger fired')
  const topics = log.topics;

  if (topics.length < 2) {
    runtime.log('Log payload does not contain enough topics');
    throw new Error(`Log payload does not contain enough topics ${topics.length}`);
  }

  // Extract marketId from the first indexed topic (topic1)
  const marketIdTopic = topics[1];
  const marketId = marketIdTopic
    ? Number(bytesToBigint(marketIdTopic))
    : 0;

  runtime.log(`EVM Log Trigger: ResolutionRequested for market ${marketId}`);
  resolveMarket(runtime, marketId);
  return {};
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function main() {
  const runner = await Runner.newRunner<Config>({
    configSchema: ConfigSchema,
  });
  await runner.run(initWorkflow);
}

main();

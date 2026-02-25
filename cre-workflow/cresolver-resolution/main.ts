import {
  EVMClient,
  HTTPCapability,
  bytesToBigint,
  getNetwork,
  handler,
  Runner,
  type EVMLog,
  type HTTPPayload,
  type Runtime,
} from "@chainlink/cre-sdk";
import { keccak256, toBytes, type Address } from "viem";

import { ConfigSchema, type Config, type EvmConfig } from "./types";
import { readMarketWorkers, readMarketQuestion, submitResolution } from "./chain/evm";
import { queryAllAgents, challengeAllAgents } from "./agents/query";
import { evaluateWithLLM } from "./agents/llm";
import { computeResolution } from "./resolution/evaluate";
import { validateEndpoints } from "./agents/validate";
import { generateMockDeterminations, generateMockChallengeResults } from "./agents/mock";

// ─── Event signature for the EVM Log Trigger ─────────────────────────────────

// keccak256("ResolutionRequested(uint256,string)")
/*
const RESOLUTION_REQUESTED_TOPIC = keccak256(
  toBytes("ResolutionRequested(uint256,string)"),
);
*/

function resolveEvmClient(evmConfig: EvmConfig): EVMClient {
  if (evmConfig.chainSelectorName) {
    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: evmConfig.chainSelectorName,
      isTestnet: true,
    });
    if (!network) {
      throw new Error(`Network not found for chain selector name: ${evmConfig.chainSelectorName}`);
    }
    return new EVMClient(network.chainSelector.selector);
  }
  if (evmConfig.chain_selector !== undefined) {
    return new EVMClient(BigInt(evmConfig.chain_selector));
  }
  throw new Error("Either chainSelectorName or chain_selector must be provided in config");
}

/*
function marketIdFromLog(log: EVMLog): number {
  if (log.topics.length < 2 || !log.topics[1]) {
    throw new Error(
      `ResolutionRequested log missing indexed marketId topic (topics=${log.topics.length})`,
    );
  }
  const marketIdTopic = log.topics[1];
  return Number(bytesToBigint(marketIdTopic));
}
*/

// ─── Core resolution logic (shared by both triggers) ─────────────────────────

function resolveMarket(
  runtime: Runtime<Config>,
  marketId: number,
): void {
  const evm = runtime.config.evms[0];
  const evmClient = resolveEvmClient(evm);
  const useMock = runtime.config.mockAgentResponses === true;

  runtime.log(`Starting resolution for market ${marketId}`);

  // Step 1: Read market data and worker info from chain
  const question = readMarketQuestion(runtime, evmClient, marketId);
  const { workers, report } = readMarketWorkers(runtime, evmClient, marketId);

  runtime.log(`Market question: "${question.slice(0, 80)}"`);
  runtime.log(
    `Discovery: ${report.totalOnChain} on-chain, ${report.validWorkers} valid, ${report.discarded.length} discarded`,
  );

  // Step 2: AI pipeline — query agents (or mock), challenge, evaluate with LLM
  let determinations;
  let challengeResults;
  let activeWorkers = workers;

  if (useMock) {
    runtime.log("Mock mode: generating synthetic agent responses");
    determinations = generateMockDeterminations(workers, marketId, question);
    challengeResults = generateMockChallengeResults(workers, determinations);
  } else {
    // Validate endpoints before querying
    const validation = validateEndpoints(runtime, workers);
    activeWorkers = validation.reachable;

    // Merge unreachable into discovery report
    for (const u of validation.unreachable) {
      report.discarded.push(u);
    }
    report.validWorkers = activeWorkers.length;

    if (activeWorkers.length === 0) {
      throw new Error("No reachable workers after endpoint validation");
    }

    determinations = queryAllAgents(runtime, activeWorkers, marketId, question);
    challengeResults = challengeAllAgents(runtime, activeWorkers, determinations);
  }

  const evaluations = evaluateWithLLM(runtime, question, determinations, challengeResults);
  const resolution = computeResolution(determinations, evaluations, activeWorkers);

  // Step 3: Submit resolution on-chain via signed report
  submitResolution(runtime, evmClient, marketId, resolution);

  runtime.log(
    `Market ${marketId} resolved: ${resolution.resolution ? "YES" : "NO"} with ${resolution.workers.length} workers`,
  );
}

// ─── Trigger handlers ─────────────────────────────────────────────────────────
/*
const onLogTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  const marketId = marketIdFromLog(log);
  runtime.log(`EVM Log Trigger: ResolutionRequested for market ${marketId}`);
  //resolveMarket(runtime, marketId);
  return "Only logging for now, resolution logic is commented out for testing";
};
*/

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
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
  resolveMarket(runtime, marketId);
  return `Market ${marketId} resolution submitted`;
};

// ─── Workflow wiring ──────────────────────────────────────────────────────────

function initWorkflow(config: Config) {
  //const evm = config.evms[0];
  //const evmClient = resolveEvmClient(evm);
  //const marketAddr = evm.market_address as Address;


  // ── Trigger: HTTP Trigger ─────────────────────────────────────────────
  const httpTrigger = new HTTPCapability().trigger({
    authorizedKeys: [
      {
        type: "KEY_TYPE_ECDSA_EVM",
        publicKey: config.authorizedEVMAddress
      }
    ]
  });

  return [
    //handler(evmLogTrigger, onLogTrigger),
    handler(httpTrigger, onHttpTrigger),
  ];
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function main() {
  const runner = await Runner.newRunner<Config>({
    configSchema: ConfigSchema,
  });
  await runner.run(initWorkflow);
}

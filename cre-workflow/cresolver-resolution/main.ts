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

import { ConfigSchema, type Config, type EvmConfig, type WorkerData, type ResolutionResult } from "./types";
import { readMarketWorkers, readMarketQuestion, submitResolution } from "./evm";
// AI agent functions — kept for future activation
// import { queryAllAgents, challengeAllAgents } from "./agents";
// import { evaluateWorkers, computeResolution } from "./evaluate";

// ─── Event signature for the EVM Log Trigger ─────────────────────────────────

// keccak256("ResolutionRequested(uint256,string)")
const RESOLUTION_REQUESTED_TOPIC = keccak256(
  toBytes("ResolutionRequested(uint256,string)"),
);

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

function marketIdFromLog(log: EVMLog): number {
  if (log.topics.length < 2 || !log.topics[1]) {
    throw new Error(
      `ResolutionRequested log missing indexed marketId topic (topics=${log.topics.length})`,
    );
  }
  const marketIdTopic = log.topics[1];
  return Number(bytesToBigint(marketIdTopic));
}

// ─── Mock resolution (bypasses AI agents for on-chain flow testing) ──────────

function computeMockResolution(workers: WorkerData[]): ResolutionResult {
  const addresses = workers.map((w) => w.address);
  const weights = workers.map(() => BigInt(100));

  // 3 dimension scores per worker: [resQuality, srcQuality, analysisDepth]
  const dimScores: number[] = [];
  for (let i = 0; i < workers.length; i++) {
    dimScores.push(80); // resolutionQuality
    dimScores.push(75); // sourceQuality
    dimScores.push(70); // analysisDepth
  }

  return {
    resolution: true,
    workers: addresses,
    weights,
    dimScores,
  };
}

// ─── Core resolution logic (shared by both triggers) ─────────────────────────

function resolveMarket(
  runtime: Runtime<Config>,
  marketId: number,
): void {
  const evm = runtime.config.evms[0];
  const evmClient = resolveEvmClient(evm);

  runtime.log(`Starting resolution for market ${marketId}`);

  // Step 1: Read market data and worker info from chain
  const question = readMarketQuestion(runtime, evmClient, marketId);
  const workers = readMarketWorkers(runtime, evmClient, marketId);

  runtime.log(`Market question: "${question.slice(0, 80)}"`);
  runtime.log(`Found ${workers.length} workers on-chain`);

  // Step 2: Compute mock resolution (FUTURE: queryAllAgents + challengeAllAgents + evaluateWorkers)
  const resolution = computeMockResolution(workers);

  // Step 3: Submit resolution on-chain via signed report
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
  const evm = config.evms[0];
  const evmClient = resolveEvmClient(evm);
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

import {
  EVMClient,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  encodeCallMsg,
  prepareReportRequest,
  bytesToHex,
} from "@chainlink/cre-sdk";
import {
  encodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  type Address,
  type Hex,
} from "viem";
import type { Config, WorkerData, ResolutionResult } from "./types.js";

// ─── ABI fragments for viem encoding ────────────────────────────────────────

const getMarketAbi = [
  {
    name: "getMarket",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "question", type: "string" },
          { name: "rewardPool", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "creator", type: "address" },
          { name: "resolved", type: "bool" },
        ],
      },
    ],
  },
] as const;

const getMarketWorkersAbi = [
  {
    name: "getMarketWorkers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
] as const;

const stakesAbi = [
  {
    name: "stakes",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "worker", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const getReputationAbi = [
  {
    name: "getReputation",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "worker", type: "address" }],
    outputs: [
      { name: "resQuality", type: "uint256" },
      { name: "srcQuality", type: "uint256" },
      { name: "analysisDepth", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
  },
] as const;

// Zero address used as `from` in read calls
const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

// ─── Read market data and worker info ────────────────────────────────────────

export function readMarketWorkers(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  marketId: number,
): WorkerData[] {
  const config = runtime.config;
  const evm = config.evms[0];
  const marketAddr = evm.market_address as Address;

  // Read market data
  const marketCallData = encodeFunctionData({
    abi: getMarketAbi,
    functionName: "getMarket",
    args: [BigInt(marketId)],
  });

  const marketResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: ZERO_ADDRESS,
        to: marketAddr,
        data: marketCallData,
      }),
    })
    .result();

  const marketDecoded = decodeFunctionResult({
    abi: getMarketAbi,
    functionName: "getMarket",
    data: bytesToHex(marketResult.data),
  });

  const market = marketDecoded as unknown as {
    question: string;
    rewardPool: bigint;
    deadline: bigint;
    creator: string;
    resolved: boolean;
  };

  if (market.resolved) {
    throw new Error(`Market ${marketId} is already resolved`);
  }

  // Read worker addresses
  const workersCallData = encodeFunctionData({
    abi: getMarketWorkersAbi,
    functionName: "getMarketWorkers",
    args: [BigInt(marketId)],
  });

  const workersResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: ZERO_ADDRESS,
        to: marketAddr,
        data: workersCallData,
      }),
    })
    .result();

  const workerAddresses = decodeFunctionResult({
    abi: getMarketWorkersAbi,
    functionName: "getMarketWorkers",
    data: bytesToHex(workersResult.data),
  }) as Address[];

  // Read each worker's stake and reputation
  const workers: WorkerData[] = [];
  for (let i = 0; i < workerAddresses.length; i++) {
    const addr = workerAddresses[i];

    // Match workers to agents by index (agent[i] → worker[i])
    const agent = config.agents[i];
    if (!agent) continue;

    // Read stake
    const stakeCallData = encodeFunctionData({
      abi: stakesAbi,
      functionName: "stakes",
      args: [BigInt(marketId), addr],
    });

    const stakeResult = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: ZERO_ADDRESS,
          to: marketAddr,
          data: stakeCallData,
        }),
      })
      .result();

    const stake = decodeFunctionResult({
      abi: stakesAbi,
      functionName: "stakes",
      data: bytesToHex(stakeResult.data),
    }) as bigint;

    // Read reputation
    const repCallData = encodeFunctionData({
      abi: getReputationAbi,
      functionName: "getReputation",
      args: [addr],
    });

    const repResult = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: ZERO_ADDRESS,
          to: marketAddr,
          data: repCallData,
        }),
      })
      .result();

    const repDecoded = decodeFunctionResult({
      abi: getReputationAbi,
      functionName: "getReputation",
      data: bytesToHex(repResult.data),
    }) as readonly [bigint, bigint, bigint, bigint];

    workers.push({
      address: addr,
      endpoint: agent.endpoint,
      stake,
      reputation: {
        resQuality: Number(repDecoded[0]),
        srcQuality: Number(repDecoded[1]),
        analysisDepth: Number(repDecoded[2]),
        count: Number(repDecoded[3]),
      },
    });
  }

  runtime.log(
    `Read ${workers.length} workers for market ${marketId}: "${market.question.slice(0, 60)}..."`,
  );

  return workers;
}

// ─── Get market question ─────────────────────────────────────────────────────

export function readMarketQuestion(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  marketId: number,
): string {
  const marketAddr = runtime.config.evms[0].market_address as Address;

  const callData = encodeFunctionData({
    abi: getMarketAbi,
    functionName: "getMarket",
    args: [BigInt(marketId)],
  });

  const result = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: ZERO_ADDRESS,
        to: marketAddr,
        data: callData,
      }),
    })
    .result();

  const decoded = decodeFunctionResult({
    abi: getMarketAbi,
    functionName: "getMarket",
    data: bytesToHex(result.data),
  }) as unknown as { question: string };

  return decoded.question;
}

// ─── Submit resolution on-chain ──────────────────────────────────────────────

export function submitResolution(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  marketId: number,
  result: ResolutionResult,
): void {
  const evm = runtime.config.evms[0];
  const receiverAddr = evm.receiver_address as Address;

  // Encode the resolution payload
  const dimScoresU8 = result.dimScores.map((s) =>
    Math.max(0, Math.min(100, Math.round(s))),
  );

  const encodedPayload = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address[]" },
      { type: "uint256[]" },
      { type: "uint8[]" },
      { type: "bool" },
    ],
    [
      BigInt(marketId),
      result.workers as Address[],
      result.weights,
      dimScoresU8,
      result.resolution,
    ],
  );

  // Sign the report via DON consensus
  const reportRequest = prepareReportRequest(encodedPayload);
  const report = runtime.report(reportRequest).result();

  // Write the signed report to the receiver contract
  evmClient
    .writeReport(runtime, {
      receiver: receiverAddr,
      report,
      gasConfig: {
        gasLimit: evm.gasLimit,
      },
    })
    .result();

  runtime.log(
    `Resolution submitted for market ${marketId}: ${result.resolution ? "YES" : "NO"} with ${result.workers.length} workers`,
  );
}

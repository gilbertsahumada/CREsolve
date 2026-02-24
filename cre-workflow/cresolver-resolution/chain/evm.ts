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
import type { Config, WorkerData, ResolutionResult } from "../types.js";

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

const identityRegistryAbi = [
  {
    name: "identityRegistry",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const workerAgentIdsAbi = [
  {
    name: "workerAgentIds",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "worker", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const tokenURIAbi = [
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
] as const;

const aggregate3Abi = [
  {
    name: "aggregate3",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

// Zero address used as `from` in read calls
const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

// Multicall3 is deployed at this deterministic address on all major EVM chains
const MULTICALL3_ADDRESS: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

// ─── Multicall3 helper ──────────────────────────────────────────────────────

interface MulticallCall {
  target: Address;
  allowFailure: boolean;
  callData: Hex;
}

interface MulticallResult {
  success: boolean;
  returnData: Hex;
}

function multicall3(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  calls: MulticallCall[],
): MulticallResult[] {
  const callData = encodeFunctionData({
    abi: aggregate3Abi,
    functionName: "aggregate3",
    args: [calls],
  });

  const result = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: ZERO_ADDRESS,
        to: MULTICALL3_ADDRESS,
        data: callData,
      }),
    })
    .result();

  return decodeFunctionResult({
    abi: aggregate3Abi,
    functionName: "aggregate3",
    data: bytesToHex(result.data),
  }) as unknown as MulticallResult[];
}

// ─── Helpers for on-chain endpoint resolution ───────────────────────────────

function fromBase64(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "base64").toString("utf-8");
  }
  return atob(str);
}

interface RegistrationService {
  name: string;
  endpoint: string;
}

function parseA2aEndpoint(dataUri: string): string | null {
  const prefix = "data:application/json;base64,";
  if (!dataUri.startsWith(prefix)) {
    return null;
  }

  try {
    const jsonStr = fromBase64(dataUri.slice(prefix.length));
    const registration = JSON.parse(jsonStr) as {
      services?: RegistrationService[];
    };

    if (!Array.isArray(registration.services)) {
      return null;
    }

    // Match "A2A" service name (case-insensitive to be robust)
    const a2aService = registration.services.find(
      (s) =>
        s.name.toUpperCase() === "A2A" && typeof s.endpoint === "string",
    );
    return a2aService?.endpoint ?? null;
  } catch {
    return null;
  }
}

// ─── Read market data and worker info ────────────────────────────────────────

export function readMarketWorkers(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  marketId: number,
): WorkerData[] {
  const evm = runtime.config.evms[0];
  const marketAddr = evm.market_address as Address;

  // ── Batch 1: getMarket + getMarketWorkers + identityRegistry ────────────
  const batch1 = multicall3(runtime, evmClient, [
    {
      target: marketAddr,
      allowFailure: false,
      callData: encodeFunctionData({
        abi: getMarketAbi,
        functionName: "getMarket",
        args: [BigInt(marketId)],
      }),
    },
    {
      target: marketAddr,
      allowFailure: false,
      callData: encodeFunctionData({
        abi: getMarketWorkersAbi,
        functionName: "getMarketWorkers",
        args: [BigInt(marketId)],
      }),
    },
    {
      target: marketAddr,
      allowFailure: false,
      callData: encodeFunctionData({
        abi: identityRegistryAbi,
        functionName: "identityRegistry",
      }),
    },
  ]);

  const market = decodeFunctionResult({
    abi: getMarketAbi,
    functionName: "getMarket",
    data: batch1[0].returnData,
  }) as unknown as {
    question: string;
    rewardPool: bigint;
    deadline: bigint;
    creator: string;
    resolved: boolean;
  };

  if (market.resolved) {
    throw new Error(`Market ${marketId} is already resolved`);
  }

  const workerAddresses = decodeFunctionResult({
    abi: getMarketWorkersAbi,
    functionName: "getMarketWorkers",
    data: batch1[1].returnData,
  }) as Address[];

  const identityRegistryAddr = decodeFunctionResult({
    abi: identityRegistryAbi,
    functionName: "identityRegistry",
    data: batch1[2].returnData,
  }) as Address;

  if (workerAddresses.length === 0) {
    throw new Error(`Market ${marketId} has no workers`);
  }

  // ── Batch 2: per-worker agentId + stake + reputation ────────────────────
  // Layout: [agentId_0, stake_0, rep_0, agentId_1, stake_1, rep_1, ...]
  const batch2Calls: MulticallCall[] = [];
  for (const addr of workerAddresses) {
    batch2Calls.push({
      target: marketAddr,
      allowFailure: false,
      callData: encodeFunctionData({
        abi: workerAgentIdsAbi,
        functionName: "workerAgentIds",
        args: [BigInt(marketId), addr],
      }),
    });
    batch2Calls.push({
      target: marketAddr,
      allowFailure: false,
      callData: encodeFunctionData({
        abi: stakesAbi,
        functionName: "stakes",
        args: [BigInt(marketId), addr],
      }),
    });
    batch2Calls.push({
      target: marketAddr,
      allowFailure: false,
      callData: encodeFunctionData({
        abi: getReputationAbi,
        functionName: "getReputation",
        args: [addr],
      }),
    });
  }

  const batch2 = multicall3(runtime, evmClient, batch2Calls);

  // Parse batch 2: extract agentIds for batch 3
  const agentIds: bigint[] = [];
  const stakes: bigint[] = [];
  const reputations: Array<readonly [bigint, bigint, bigint, bigint]> = [];

  for (let i = 0; i < workerAddresses.length; i++) {
    const base = i * 3;

    agentIds.push(
      decodeFunctionResult({
        abi: workerAgentIdsAbi,
        functionName: "workerAgentIds",
        data: batch2[base].returnData,
      }) as bigint,
    );

    stakes.push(
      decodeFunctionResult({
        abi: stakesAbi,
        functionName: "stakes",
        data: batch2[base + 1].returnData,
      }) as bigint,
    );

    reputations.push(
      decodeFunctionResult({
        abi: getReputationAbi,
        functionName: "getReputation",
        data: batch2[base + 2].returnData,
      }) as readonly [bigint, bigint, bigint, bigint],
    );
  }

  // ── Batch 3: tokenURI for each worker (needs agentIds from batch 2) ─────
  const batch3Calls: MulticallCall[] = agentIds.map((agentId) => ({
    target: identityRegistryAddr,
    allowFailure: true, // tokenURI may fail for invalid agentIds
    callData: encodeFunctionData({
      abi: tokenURIAbi,
      functionName: "tokenURI",
      args: [agentId],
    }),
  }));

  const batch3 = multicall3(runtime, evmClient, batch3Calls);

  // ── Assemble WorkerData from all batches ────────────────────────────────
  const workers: WorkerData[] = [];

  for (let i = 0; i < workerAddresses.length; i++) {
    const addr = workerAddresses[i];

    if (!batch3[i].success) {
      runtime.log(
        `Worker ${addr.slice(0, 10)}... (agentId=${agentIds[i]}): tokenURI call failed, skipping`,
      );
      continue;
    }

    const tokenURI = decodeFunctionResult({
      abi: tokenURIAbi,
      functionName: "tokenURI",
      data: batch3[i].returnData,
    }) as string;

    const endpoint = parseA2aEndpoint(tokenURI);
    if (!endpoint) {
      runtime.log(
        `Worker ${addr.slice(0, 10)}... (agentId=${agentIds[i]}): no A2A service in tokenURI, skipping`,
      );
      continue;
    }

    const rep = reputations[i];
    workers.push({
      address: addr,
      endpoint,
      stake: stakes[i],
      reputation: {
        resQuality: Number(rep[0]),
        srcQuality: Number(rep[1]),
        analysisDepth: Number(rep[2]),
        count: Number(rep[3]),
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

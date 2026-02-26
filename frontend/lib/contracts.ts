// ABI fragments for viem — copied from cre-workflow/cresolver-resolution/chain/evm.ts

export const getMarketAbi = [
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

export const getMarketWorkersAbi = [
  {
    name: "getMarketWorkers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
] as const;

export const stakesAbi = [
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

export const getReputationAbi = [
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

export const marketCountAbi = [
  {
    name: "marketCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

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
          { name: "resolution", type: "bool" },
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

// ─── BinaryMarket ABIs ─────────────────────────────────────────────────────

export const getPoolAbi = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "yesTotal", type: "uint256" },
      { name: "noTotal", type: "uint256" },
      { name: "settled", type: "bool" },
      { name: "outcome", type: "bool" },
    ],
  },
] as const;

export const getUserPositionAbi = [
  {
    name: "getUserPosition",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "yesAmount", type: "uint256" },
      { name: "noAmount", type: "uint256" },
    ],
  },
] as const;

export const buyYesAbi = [
  {
    name: "buyYes",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
] as const;

export const buyNoAbi = [
  {
    name: "buyNo",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
] as const;

export const settleAbi = [
  {
    name: "settle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
] as const;

export const claimAbi = [
  {
    name: "claim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
] as const;

export const binaryWithdrawAbi = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

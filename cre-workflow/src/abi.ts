// Human-readable ABI fragment for CREsolverMarket
export const CREsolverMarketABI = [
  "function getMarket(uint256 marketId) view returns (tuple(string question, uint256 rewardPool, uint256 deadline, address creator, bool resolved))",
  "function getMarketWorkers(uint256 marketId) view returns (address[])",
  "function getReputation(address worker) view returns (uint256 resQuality, uint256 srcQuality, uint256 analysisDepth, uint256 count)",
  "function stakes(uint256 marketId, address worker) view returns (uint256)",
  "function isMarketActive(uint256 marketId) view returns (bool)",
  "function resolveMarket(uint256 marketId, address[] workers, uint256[] weights, uint8[] dimScores, bool resolution)",
  "function marketCount() view returns (uint256)",
  "function balances(address) view returns (uint256)",

  "event MarketCreated(uint256 indexed marketId, address indexed creator, string question, uint256 rewardPool, uint256 deadline)",
  "event MarketResolved(uint256 indexed marketId, address indexed resolver, bool resolution)",
  "event WorkerJoined(uint256 indexed marketId, address indexed worker, uint256 stake)",
];

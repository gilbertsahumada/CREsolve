// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

error EmptyQuestion();
error ZeroValue();
error InvalidDuration();
error MarketNotActive(uint256 marketId);
error BelowMinStake(uint256 sent, uint256 required);
error AlreadyJoined(uint256 marketId, address worker);
error Unauthorized(address caller);
error AlreadyResolved(uint256 marketId);
error TooManyWorkers(uint256 count, uint256 max);
error ArrayMismatch(uint256 workersLen, uint256 weightsLen, uint256 scoresLen);
error UnregisteredWorker(uint256 marketId, address worker);
error NoBalance();
error MarketDoesNotExist(uint256 marketId);
error MarketAlreadyResolved(uint256 marketId);
error NotMarketCreator(uint256 marketId, address caller);
error NotAgentOwner(address caller, uint256 agentId);
error ZeroAddress();
error DuplicateWorker(uint256 marketId, address worker);
error WorkerSetMismatch(uint256 marketId, uint256 expected, uint256 provided);
error ZeroTotalWeight(uint256 marketId);

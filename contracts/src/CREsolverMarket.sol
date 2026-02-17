// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CREsolverMarket
 * @notice Standalone market contract for CREsolver hackathon.
 *         Combines market management, worker registration, escrow,
 *         resolution, and reputation in a single contract.
 */
contract CREsolverMarket is Ownable, ReentrancyGuard {
    // ─── Structs ───────────────────────────────────────────────────────
    struct Market {
        string question;
        uint256 rewardPool;
        uint256 deadline;
        address creator;
        bool resolved;
    }

    struct Reputation {
        uint256 resQualitySum;
        uint256 srcQualitySum;
        uint256 analysisDepthSum;
        uint256 count;
    }

    // ─── State ─────────────────────────────────────────────────────────
    mapping(uint256 => Market) public markets;
    uint256 public marketCount;

    mapping(uint256 => mapping(address => uint256)) public stakes;
    mapping(uint256 => address[]) internal _marketWorkers;

    mapping(address => uint256) public balances;
    mapping(address => bool) public authorizedResolvers;
    mapping(address => Reputation) public reputation;

    uint256 public minStake = 0.01 ether;

    uint256 public constant MAX_WORKERS = 10;

    // ─── Events ────────────────────────────────────────────────────────
    event MarketCreated(uint256 indexed marketId, address indexed creator, string question, uint256 rewardPool, uint256 deadline);
    event WorkerJoined(uint256 indexed marketId, address indexed worker, uint256 stake);
    event MarketResolved(uint256 indexed marketId, address indexed resolver, bool resolution);
    event ResolverUpdated(address indexed resolver, bool authorized);
    event ReputationUpdated(address indexed worker, uint256 resQuality, uint256 srcQuality, uint256 analysisDepth, uint256 count);
    event Withdrawal(address indexed account, uint256 amount);

    // ─── Errors ────────────────────────────────────────────────────────
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

    // ─── Constructor ───────────────────────────────────────────────────
    constructor() Ownable(msg.sender) {}

    // ─── Core Functions ────────────────────────────────────────────────

    /**
     * @notice Create a new market with a question and reward pool
     * @param question The question to be resolved
     * @param duration Duration in seconds until the market deadline
     * @return marketId The ID of the newly created market
     */
    function createMarket(string calldata question, uint256 duration) external payable returns (uint256 marketId) {
        if (bytes(question).length == 0) revert EmptyQuestion();
        if (msg.value == 0) revert ZeroValue();
        if (duration == 0) revert InvalidDuration();

        marketId = marketCount++;
        markets[marketId] = Market({
            question: question,
            rewardPool: msg.value,
            deadline: block.timestamp + duration,
            creator: msg.sender,
            resolved: false
        });

        emit MarketCreated(marketId, msg.sender, question, msg.value, block.timestamp + duration);
    }

    /**
     * @notice Join an active market as a worker by staking ETH
     * @param marketId The market to join
     */
    function joinMarket(uint256 marketId) external payable {
        if (!isMarketActive(marketId)) revert MarketNotActive(marketId);
        if (msg.value < minStake) revert BelowMinStake(msg.value, minStake);
        if (stakes[marketId][msg.sender] > 0) revert AlreadyJoined(marketId, msg.sender);

        stakes[marketId][msg.sender] = msg.value;
        _marketWorkers[marketId].push(msg.sender);

        emit WorkerJoined(marketId, msg.sender, msg.value);
    }

    /**
     * @notice Resolve a market and distribute rewards to workers
     * @param marketId The market to resolve
     * @param workers Array of worker addresses
     * @param weights Array of reward weights per worker
     * @param dimScores Packed array: 3 scores per worker (resQuality, srcQuality, analysisDepth), each 0-100
     * @param resolution Whether the market resolved positively
     */
    function resolveMarket(
        uint256 marketId,
        address[] calldata workers,
        uint256[] calldata weights,
        uint8[] calldata dimScores,
        bool resolution
    ) external {
        _validateResolution(marketId, workers, weights, dimScores);

        uint256 totalWeight;
        for (uint256 i; i < workers.length; i++) {
            totalWeight += weights[i];
        }

        _distributeRewards(marketId, workers, weights, totalWeight);
        _updateReputation(workers, dimScores);

        markets[marketId].resolved = true;

        emit MarketResolved(marketId, msg.sender, resolution);
    }

    function _validateResolution(
        uint256 marketId,
        address[] calldata workers,
        uint256[] calldata weights,
        uint8[] calldata dimScores
    ) internal view {
        Market storage m = markets[marketId];

        if (m.resolved) revert AlreadyResolved(marketId);
        if (m.deadline == 0) revert MarketNotActive(marketId);
        if (workers.length > MAX_WORKERS) revert TooManyWorkers(workers.length, MAX_WORKERS);
        if (workers.length != weights.length || dimScores.length != workers.length * 3)
            revert ArrayMismatch(workers.length, weights.length, dimScores.length);
        if (!authorizedResolvers[msg.sender]) revert Unauthorized(msg.sender);

        for (uint256 i; i < workers.length; i++) {
            if (stakes[marketId][workers[i]] == 0) revert UnregisteredWorker(marketId, workers[i]);
        }
    }

    function _distributeRewards(
        uint256 marketId,
        address[] calldata workers,
        uint256[] calldata weights,
        uint256 totalWeight
    ) internal {
        uint256 rewardPool = markets[marketId].rewardPool;
        for (uint256 i; i < workers.length; i++) {
            address worker = workers[i];
            uint256 reward = (rewardPool * weights[i]) / totalWeight;
            uint256 stake = stakes[marketId][worker];
            balances[worker] += reward + stake;
            stakes[marketId][worker] = 0;
        }
    }

    function _updateReputation(
        address[] calldata workers,
        uint8[] calldata dimScores
    ) internal {
        for (uint256 i; i < workers.length; i++) {
            address worker = workers[i];
            uint256 baseIdx = i * 3;
            Reputation storage rep = reputation[worker];
            rep.resQualitySum += dimScores[baseIdx];
            rep.srcQualitySum += dimScores[baseIdx + 1];
            rep.analysisDepthSum += dimScores[baseIdx + 2];
            rep.count++;

            emit ReputationUpdated(
                worker,
                rep.resQualitySum / rep.count,
                rep.srcQualitySum / rep.count,
                rep.analysisDepthSum / rep.count,
                rep.count
            );
        }
    }

    /**
     * @notice Withdraw accumulated balance (rewards + returned stakes)
     */
    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NoBalance();

        balances[msg.sender] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawal(msg.sender, amount);
    }

    /**
     * @notice Set or revoke an authorized resolver
     * @param resolver The resolver address
     * @param authorized Whether to authorize or revoke
     */
    function setAuthorizedResolver(address resolver, bool authorized) external onlyOwner {
        authorizedResolvers[resolver] = authorized;
        emit ResolverUpdated(resolver, authorized);
    }

    // ─── View Functions ────────────────────────────────────────────────

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getMarketWorkers(uint256 marketId) external view returns (address[] memory) {
        return _marketWorkers[marketId];
    }

    function isMarketActive(uint256 marketId) public view returns (bool) {
        Market storage m = markets[marketId];
        return m.deadline > 0 && !m.resolved && block.timestamp <= m.deadline;
    }

    function getReputation(address worker) external view returns (
        uint256 resQuality,
        uint256 srcQuality,
        uint256 analysisDepth,
        uint256 count
    ) {
        Reputation storage rep = reputation[worker];
        if (rep.count == 0) return (0, 0, 0, 0);
        return (
            rep.resQualitySum / rep.count,
            rep.srcQualitySum / rep.count,
            rep.analysisDepthSum / rep.count,
            rep.count
        );
    }

    function getScoringCriteria() external pure returns (string[8] memory names, uint256[8] memory weights) {
        names = [
            "Resolution Quality",
            "Source Quality",
            "Analysis Depth",
            "Reasoning Clarity",
            "Evidence Strength",
            "Bias Awareness",
            "Timeliness",
            "Collaboration"
        ];
        weights = [uint256(20), 15, 15, 15, 10, 10, 10, 5];
    }
}

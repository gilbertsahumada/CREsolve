// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC8004IdentityV1} from "./interfaces/erc8004/IERC8004IdentityV1.sol";
import {IERC8004Reputation} from "./interfaces/erc8004/IERC8004Reputation.sol";

import {Market, Reputation} from "./lib/CREsolverMarketTypes.sol";
import "./lib/CREsolverMarketErrors.sol";

/**
 * @title CREsolverMarket
 * @notice Standalone market contract for CREsolver hackathon.
 *         Combines market management, worker registration, escrow,
 *         resolution, and reputation in a single contract.
 */
contract CREsolverMarket is Ownable, ReentrancyGuard {
    // ─── ERC-8004 Registries ────────
    IERC8004IdentityV1 public immutable identityRegistry;
    IERC8004Reputation public immutable reputationRegistry;

    // ─── State ─────────────────────────────────────────────────────────
    mapping(uint256 => Market) public markets;
    uint256 public marketCount;

    mapping(uint256 => mapping(address => uint256)) public stakes;
    mapping(uint256 => address[]) internal _marketWorkers;
    mapping(uint256 => mapping(address => uint256)) public workerAgentIds;

    mapping(address => uint256) public balances;
    mapping(address => bool) public authorizedResolvers;
    mapping(address => Reputation) public reputation;

    uint256 public minStake = 0.0001 ether;

    uint256 public constant MAX_WORKERS = 10;

    // ─── Events ────────────────────────────────────────────────────────
    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        string question,
        uint256 rewardPool,
        uint256 deadline
    );
    event WorkerJoined(
        uint256 indexed marketId,
        address indexed worker,
        uint256 stake,
        uint256 agentId
    );
    event MarketResolved(
        uint256 indexed marketId,
        address indexed resolver,
        bool resolution
    );
    event ResolverUpdated(address indexed resolver, bool authorized);
    event Withdrawal(address indexed account, uint256 amount);
    event ResolutionRequested(uint256 indexed marketId, string question);

    // ─── Constructor ───────────────────────────────────────────────────
    constructor(
        address _identityRegistry,
        address _reputationRegistry
    ) Ownable(msg.sender) {
        bool identityUnset = _identityRegistry == address(0);
        bool reputationUnset = _reputationRegistry == address(0);
        // Cant be zero address.
        if (identityUnset || reputationUnset) revert ZeroAddress();
        identityRegistry = IERC8004IdentityV1(_identityRegistry);
        reputationRegistry = IERC8004Reputation(_reputationRegistry);
        // Set owner as authorized resolver by default for testing; can be revoked later
        authorizedResolvers[msg.sender] = true;
    }

    // ─── Core Functions ────────────────────────────────────────────────

    /**
     * @notice Create a new market with a question and reward pool
     * @param question The question to be resolved
     * @param duration Duration in seconds until the market deadline
     * @return marketId The ID of the newly created market
     */
    function createMarket(
        string calldata question,
        uint256 duration
    ) external payable returns (uint256 marketId) {
        if (bytes(question).length == 0) revert EmptyQuestion();
        if (msg.value == 0) revert ZeroValue();
        if (duration == 0) revert InvalidDuration();

        marketId = marketCount++;
        markets[marketId] = Market({
            question: question,
            rewardPool: msg.value,
            deadline: block.timestamp + duration,
            creator: msg.sender,
            resolved: false,
            resolution: false
        });

        emit MarketCreated(
            marketId,
            msg.sender,
            question,
            msg.value,
            block.timestamp + duration
        );
    }

    /**
     * @notice Join an active market as a worker by staking ETH
     * @param marketId The market to join
     * @param agentId The ERC-8004 agent ID (0 if identity registry is disabled)
     */
    function joinMarket(uint256 marketId, uint256 agentId) external payable {
        if (!isMarketActive(marketId)) revert MarketNotActive(marketId);
        if (msg.value < minStake) revert BelowMinStake(msg.value, minStake);
        if (stakes[marketId][msg.sender] > 0) revert AlreadyJoined(marketId, msg.sender);
        uint256 workerCount = _marketWorkers[marketId].length;
        if (workerCount >= MAX_WORKERS) revert TooManyWorkers(workerCount + 1, MAX_WORKERS);
        if (!identityRegistry.isAuthorizedOrOwner(msg.sender, agentId)) revert NotAgentOwner(msg.sender, agentId);

        workerAgentIds[marketId][msg.sender] = agentId;

        stakes[marketId][msg.sender] = msg.value;
        _marketWorkers[marketId].push(msg.sender);

        emit WorkerJoined(marketId, msg.sender, msg.value, agentId);
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
        if (totalWeight == 0) revert ZeroTotalWeight(marketId);

        _distributeRewards(marketId, workers, weights, totalWeight);
        _updateReputation(marketId, workers, dimScores);

        markets[marketId].resolved = true;
        markets[marketId].resolution = resolution;

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
        if (
            workers.length != weights.length ||
            dimScores.length != workers.length * 3
        )
            revert ArrayMismatch(
                workers.length,
                weights.length,
                dimScores.length
            );
        if (!authorizedResolvers[msg.sender]) revert Unauthorized(msg.sender);
        uint256 expectedWorkers = _marketWorkers[marketId].length;
        if (workers.length != expectedWorkers) {
            revert WorkerSetMismatch(marketId, expectedWorkers, workers.length);
        }

        for (uint256 i; i < workers.length; i++) {
            if (stakes[marketId][workers[i]] == 0)
                revert UnregisteredWorker(marketId, workers[i]);
            for (uint256 j; j < i; j++) {
                if (workers[i] == workers[j])
                    revert DuplicateWorker(marketId, workers[i]);
            }
        }
    }

    // TODO: Workers with weight=0 (non-responsive A2A endpoints) currently get
    // their stake returned but no reward. Consider slashing their stake as a
    // penalty for failing to respond — they should not profit from inactivity.
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
        uint256 marketId,
        address[] calldata workers,
        uint8[] calldata dimScores
    ) internal {
        for (uint256 i; i < workers.length; i++) {
            uint256 baseIdx = i * 3;
            uint8 resQ = dimScores[baseIdx];
            uint8 srcQ = dimScores[baseIdx + 1];
            uint8 depthQ = dimScores[baseIdx + 2];

            Reputation storage rep = reputation[workers[i]];
            rep.resQualitySum += resQ;
            rep.srcQualitySum += srcQ;
            rep.analysisDepthSum += depthQ;
            rep.count += 1;

            if (address(reputationRegistry) == address(0)) continue;

            uint256 agentId = workerAgentIds[marketId][workers[i]];
            if (agentId == 0) continue;

            reputationRegistry.giveFeedback(
                agentId,
                int128(int256(uint256(resQ))),
                0,
                "resolution_quality",
                "cresolver",
                "",
                "",
                bytes32(0)
            );
            reputationRegistry.giveFeedback(
                agentId,
                int128(int256(uint256(srcQ))),
                0,
                "source_quality",
                "cresolver",
                "",
                "",
                bytes32(0)
            );
            reputationRegistry.giveFeedback(
                agentId,
                int128(int256(uint256(depthQ))),
                0,
                "analysis_depth",
                "cresolver",
                "",
                "",
                bytes32(0)
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
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawal(msg.sender, amount);
    }

    /**
     * @notice Set or revoke an authorized resolver
     * @param resolver The resolver address
     * @param authorized Whether to authorize or revoke
     */
    function setAuthorizedResolver(
        address resolver,
        bool authorized
    ) external onlyOwner {
        authorizedResolvers[resolver] = authorized;
        emit ResolverUpdated(resolver, authorized);
    }

    /**
     * @notice Request resolution for a market, emitting an event for CRE EVM Log Trigger
     * @param marketId The market to request resolution for
     */
    function requestResolution(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (m.deadline == 0) revert MarketDoesNotExist(marketId);
        if (m.resolved) revert MarketAlreadyResolved(marketId);
        emit ResolutionRequested(marketId, m.question);
    }

    // ─── View Functions ────────────────────────────────────────────────

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getMarketWorkers(
        uint256 marketId
    ) external view returns (address[] memory) {
        return _marketWorkers[marketId];
    }

    function isMarketActive(uint256 marketId) public view returns (bool) {
        Market storage m = markets[marketId];
        return m.deadline > 0 && !m.resolved && block.timestamp <= m.deadline;
    }

    function getReputation(
        address worker
    )
        external
        view
        returns (
            uint256 resQuality,
            uint256 srcQuality,
            uint256 analysisDepth,
            uint256 count
        )
    {
        Reputation storage rep = reputation[worker];
        count = rep.count;
        if (count == 0) return (0, 0, 0, 0);

        resQuality = rep.resQualitySum / count;
        srcQuality = rep.srcQualitySum / count;
        analysisDepth = rep.analysisDepthSum / count;
    }

    function getScoringCriteria()
        external
        pure
        returns (string[8] memory names, uint256[8] memory weights)
    {
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Market} from "./lib/CREsolverMarketTypes.sol";

interface ICREsolverMarket {
    function getMarket(uint256 marketId) external view returns (Market memory);
}

/**
 * @title BinaryMarket
 * @notice Companion betting contract for CREsolverMarket.
 *         Users bet ETH on YES/NO outcomes. After CREsolverMarket resolves,
 *         anyone can call settle() to finalize payouts (earning a 1% fee).
 *         Winners claim proportional share of the losing pool.
 */
contract BinaryMarket is Ownable, ReentrancyGuard {
    ICREsolverMarket public coreMarket;

    uint256 public constant SETTLEMENT_FEE_BPS = 100; // 1%

    struct Pool {
        uint256 yesTotal;
        uint256 noTotal;
        bool settled;
        bool outcome; // true = YES won, false = NO won
    }

    struct Position {
        uint256 yesAmount;
        uint256 noAmount;
    }

    mapping(uint256 => Pool) public pools;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(address => uint256) public balances;

    event BetPlaced(uint256 indexed marketId, address indexed bettor, bool isYes, uint256 amount);
    event Settled(uint256 indexed marketId, address indexed settler, bool outcome, uint256 fee);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 payout);
    event Withdrawal(address indexed account, uint256 amount);
    event CoreMarketUpdated(address indexed oldMarket, address indexed newMarket);

    constructor(address _coreMarket) Ownable(msg.sender) {
        require(_coreMarket != address(0), "Zero address");
        coreMarket = ICREsolverMarket(_coreMarket);
    }

    /**
     * @notice Update the CREsolverMarket address (avoids redeploying BinaryMarket)
     * @param _newCoreMarket The new CREsolverMarket address
     */
    function setCoreMarket(address _newCoreMarket) external onlyOwner {
        require(_newCoreMarket != address(0), "Zero address");
        address old = address(coreMarket);
        coreMarket = ICREsolverMarket(_newCoreMarket);
        emit CoreMarketUpdated(old, _newCoreMarket);
    }

    // ─── Betting ────────────────────────────────────────────────────────

    function buyYes(uint256 marketId) external payable {
        _placeBet(marketId, true);
    }

    function buyNo(uint256 marketId) external payable {
        _placeBet(marketId, false);
    }

    function _placeBet(uint256 marketId, bool isYes) internal {
        require(msg.value > 0, "Must send ETH");

        Market memory m = coreMarket.getMarket(marketId);
        require(m.deadline > 0, "Market does not exist");
        require(!m.resolved, "Market already resolved");
        require(block.timestamp <= m.deadline, "Market expired");

        Pool storage pool = pools[marketId];
        require(!pool.settled, "Already settled");

        Position storage pos = positions[marketId][msg.sender];

        if (isYes) {
            pool.yesTotal += msg.value;
            pos.yesAmount += msg.value;
        } else {
            pool.noTotal += msg.value;
            pos.noAmount += msg.value;
        }

        emit BetPlaced(marketId, msg.sender, isYes, msg.value);
    }

    // ─── Settlement ─────────────────────────────────────────────────────

    function settle(uint256 marketId) external {
        Pool storage pool = pools[marketId];
        require(!pool.settled, "Already settled");

        Market memory m = coreMarket.getMarket(marketId);
        require(m.resolved, "Market not resolved yet");

        pool.settled = true;
        pool.outcome = m.resolution;

        uint256 totalPool = pool.yesTotal + pool.noTotal;
        uint256 fee = 0;

        if (totalPool > 0) {
            fee = (totalPool * SETTLEMENT_FEE_BPS) / 10000;
            balances[msg.sender] += fee;
        }

        emit Settled(marketId, msg.sender, m.resolution, fee);
    }

    // ─── Claiming ───────────────────────────────────────────────────────

    function claim(uint256 marketId) external {
        Pool storage pool = pools[marketId];
        require(pool.settled, "Not settled yet");

        Position storage pos = positions[marketId][msg.sender];
        uint256 userBet;
        uint256 winningSide;

        if (pool.outcome) {
            userBet = pos.yesAmount;
            winningSide = pool.yesTotal;
            pos.yesAmount = 0;
        } else {
            userBet = pos.noAmount;
            winningSide = pool.noTotal;
            pos.noAmount = 0;
        }

        require(userBet > 0, "No winning position");

        uint256 totalPool = pool.yesTotal + pool.noTotal;
        uint256 fee = (totalPool * SETTLEMENT_FEE_BPS) / 10000;
        uint256 netPool = totalPool - fee;

        uint256 payout;
        if (winningSide == 0) {
            // Edge case: nobody bet on winning side — shouldn't happen if userBet > 0
            payout = 0;
        } else {
            payout = (userBet * netPool) / winningSide;
        }

        balances[msg.sender] += payout;

        emit Claimed(marketId, msg.sender, payout);
    }

    // ─── Withdrawal ─────────────────────────────────────────────────────

    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");

        balances[msg.sender] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawal(msg.sender, amount);
    }

    // ─── View Functions ─────────────────────────────────────────────────

    function getPool(uint256 marketId) external view returns (uint256 yesTotal, uint256 noTotal, bool settled, bool outcome) {
        Pool storage p = pools[marketId];
        return (p.yesTotal, p.noTotal, p.settled, p.outcome);
    }

    function getUserPosition(uint256 marketId, address user) external view returns (uint256 yesAmount, uint256 noAmount) {
        Position storage pos = positions[marketId][user];
        return (pos.yesAmount, pos.noAmount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";
import {Market} from "../src/lib/CREsolverMarketTypes.sol";
import {IERC8004IdentityV1} from "../src/interfaces/erc8004/IERC8004IdentityV1.sol";
import {AlreadyJoined, NotAgentOwner} from "../src/lib/CREsolverMarketErrors.sol";

contract CREsolverMarketForkTest is Test {
    // Deployed contracts on Sepolia
    address constant DEPLOYED_MARKET = 0x9B8927d8F78e82C3Be1a233519EDD9e353A318D2;
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    CREsolverMarket internal market;
    bool internal forkEnabled;

    address internal worker;
    uint256 internal workerAgentId;

    function setUp() public {
        string memory rpcUrl = vm.envOr("SEPOLIA_RPC", string(""));
        worker = vm.envOr("FORK_WORKER_ADDRESS", address(0));
        workerAgentId = vm.envOr("FORK_AGENT_ID", uint256(0));

        if (
            bytes(rpcUrl).length == 0 ||
            worker == address(0) ||
            workerAgentId == 0
        ) {
            emit log("Skipping fork setup: set SEPOLIA_RPC, FORK_WORKER_ADDRESS, FORK_AGENT_ID");
            return;
        }

        vm.createSelectFork(rpcUrl);
        forkEnabled = true;

        // Point to the real deployed contract
        market = CREsolverMarket(DEPLOYED_MARKET);

        // Verify worker is authorized in the real Identity Registry
        bool authorized = IERC8004IdentityV1(IDENTITY_REGISTRY).isAuthorizedOrOwner(
            worker,
            workerAgentId
        );
        require(authorized, "FORK_WORKER_ADDRESS is not authorized for FORK_AGENT_ID on Sepolia");
    }

    // ─── Inspect on-chain state ──────────────────────────────────────

    function test_inspect_deployed_market() public view {
        if (!forkEnabled) return;

        uint256 count = market.marketCount();
        console.log("=== Deployed CREsolverMarket ===");
        console.log("  Address:", DEPLOYED_MARKET);
        console.log("  Total markets:", count);

        for (uint256 i = 0; i < count; i++) {
            Market memory m = market.getMarket(i);
            address[] memory workers = market.getMarketWorkers(i);

            console.log("");
            console.log("  --- Market #%d ---", i);
            console.log("    Question:", m.question);
            console.log("    Reward pool: %d wei", m.rewardPool);
            console.log("    Deadline: %d", m.deadline);
            console.log("    Creator:", m.creator);
            console.log("    Resolved:", m.resolved ? "YES" : "NO");
            console.log("    Workers: %d", workers.length);

            for (uint256 j = 0; j < workers.length; j++) {
                uint256 stake = market.stakes(i, workers[j]);
                console.log("      [%d] %s (stake: %d wei)", j, workers[j], stake);
            }
        }
    }

    // ─── Tests against real deployed contract ────────────────────────

    function test_worker_already_joined_reverts() public {
        if (!forkEnabled) return;

        // Market #3 has a 1-day duration (stays active long enough for testing).
        // Workers already joined via SetupDemoMarkets, so joining again should revert.
        uint256 mid = 3;
        vm.deal(worker, 1 ether);
        vm.prank(worker);
        vm.expectRevert(
            abi.encodeWithSelector(AlreadyJoined.selector, mid, worker)
        );
        market.joinMarket{value: 0.005 ether}(mid, workerAgentId);
    }

    function test_unauthorized_worker_reverts() public {
        if (!forkEnabled) return;

        // A random address should not be able to join with someone else's agentId
        // Use market #3 (1-day duration, stays active)
        uint256 mid = 3;
        address unauthorizedWorker = makeAddr("unauthorizedWorker");
        vm.deal(unauthorizedWorker, 1 ether);

        vm.prank(unauthorizedWorker);
        vm.expectRevert(
            abi.encodeWithSelector(NotAgentOwner.selector, unauthorizedWorker, workerAgentId)
        );
        market.joinMarket{value: 0.005 ether}(mid, workerAgentId);
    }

    function test_resolve_market_on_fork() public {
        if (!forkEnabled) return;

        uint256 mid = 3;
        Market memory m = market.getMarket(mid);
        require(!m.resolved, "Market already resolved");

        address[] memory workers = market.getMarketWorkers(mid);
        uint256 workerCount = workers.length;

        console.log("=== Resolving Market #%d on fork ===", mid);
        console.log("  Question:", m.question);
        console.log("  Workers:", workerCount);

        // Build mock weights and scores (simulates what CRE workflow would compute)
        uint256[] memory weights = new uint256[](workerCount);
        uint8[] memory dimScores = new uint8[](workerCount * 3);

        for (uint256 i = 0; i < workerCount; i++) {
            weights[i] = 100; // equal weight
            dimScores[i * 3]     = 80; // resolutionQuality
            dimScores[i * 3 + 1] = 75; // sourceQuality
            dimScores[i * 3 + 2] = 70; // analysisDepth
        }

        // Record balances before resolution
        uint256[] memory balancesBefore = new uint256[](workerCount);
        for (uint256 i = 0; i < workerCount; i++) {
            balancesBefore[i] = market.balances(workers[i]);
        }

        // Resolve as the contract owner (deployer is authorized resolver)
        address owner = market.owner();
        vm.prank(owner);
        market.resolveMarket(mid, workers, weights, dimScores, true);

        // Verify market is resolved
        Market memory resolved = market.getMarket(mid);
        assertTrue(resolved.resolved, "Market should be resolved");

        // Verify rewards + stakes were distributed
        console.log("");
        console.log("  === Post-resolution ===");
        for (uint256 i = 0; i < workerCount; i++) {
            uint256 balance = market.balances(workers[i]);
            assertTrue(balance > balancesBefore[i], "Worker should have received rewards");
            console.log("    [%d] %s balance: %d wei", i, workers[i], balance);
        }

        // Verify reputation was updated
        for (uint256 i = 0; i < workerCount; i++) {
            (uint256 resQ, uint256 srcQ, uint256 depth, uint256 count) = market.getReputation(workers[i]);
            assertTrue(count > 0, "Worker should have reputation count");
            console.log("    [%d] reputation: resQ=%d srcQ=%d", i, resQ, srcQ);
            console.log("        depth=%d count=%d", depth, count);
        }

        console.log("");
        console.log("  Market #%d resolved successfully", mid);
    }

    function test_market_state_is_consistent() public view {
        if (!forkEnabled) return;

        uint256 mid = 3;
        Market memory m = market.getMarket(mid);
        address[] memory workers = market.getMarketWorkers(mid);

        // Market exists and has data
        assertTrue(bytes(m.question).length > 0, "Market should have a question");
        assertTrue(m.rewardPool > 0, "Market should have a reward pool");
        assertTrue(m.deadline > 0, "Market should have a deadline");
        assertTrue(m.creator != address(0), "Market should have a creator");

        // Workers joined
        assertTrue(workers.length > 0, "Market should have workers");

        // Each worker has a stake
        for (uint256 i = 0; i < workers.length; i++) {
            uint256 stake = market.stakes(mid, workers[i]);
            assertTrue(stake > 0, "Each worker should have a stake");
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";
import {IERC8004Reputation} from "../src/interfaces/erc8004/IERC8004Reputation.sol";

contract CREsolverMarketTest is Test {
    CREsolverMarket public market;

    address owner = address(this);
    address resolver = makeAddr("resolver");
    address worker1 = makeAddr("worker1");
    address worker2 = makeAddr("worker2");
    address worker3 = makeAddr("worker3");

    function setUp() public {
        market = new CREsolverMarket(address(0), address(0));
        market.setAuthorizedResolver(resolver, true);
    }

    // ─── createMarket ──────────────────────────────────────────────────

    function test_createMarket() public {
        uint256 id = market.createMarket{value: 1 ether}("Will ETH hit 10k?", 1 days);
        assertEq(id, 0);

        CREsolverMarket.Market memory m = market.getMarket(0);
        assertEq(m.question, "Will ETH hit 10k?");
        assertEq(m.rewardPool, 1 ether);
        assertEq(m.deadline, block.timestamp + 1 days);
        assertEq(m.creator, address(this));
        assertFalse(m.resolved);
        assertEq(market.marketCount(), 1);
    }

    function test_createMarket_reverts_empty_question() public {
        vm.expectRevert(CREsolverMarket.EmptyQuestion.selector);
        market.createMarket{value: 1 ether}("", 1 days);
    }

    function test_createMarket_reverts_zero_value() public {
        vm.expectRevert(CREsolverMarket.ZeroValue.selector);
        market.createMarket{value: 0}("Will ETH hit 10k?", 1 days);
    }

    function test_createMarket_reverts_invalid_duration() public {
        vm.expectRevert(CREsolverMarket.InvalidDuration.selector);
        market.createMarket{value: 1 ether}("Will ETH hit 10k?", 0);
    }

    // ─── joinMarket ────────────────────────────────────────────────────

    function test_joinMarket() public {
        market.createMarket{value: 1 ether}("Q?", 1 days);

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        market.joinMarket{value: 0.05 ether}(0, 0);

        assertEq(market.stakes(0, worker1), 0.05 ether);

        address[] memory workers = market.getMarketWorkers(0);
        assertEq(workers.length, 1);
        assertEq(workers[0], worker1);
    }

    function test_joinMarket_reverts_below_min_stake() public {
        market.createMarket{value: 1 ether}("Q?", 1 days);

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.BelowMinStake.selector, 0.001 ether, 0.01 ether));
        market.joinMarket{value: 0.001 ether}(0, 0);
    }

    function test_joinMarket_reverts_market_not_active() public {
        market.createMarket{value: 1 ether}("Q?", 1 days);

        // Warp past deadline
        vm.warp(block.timestamp + 2 days);

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.MarketNotActive.selector, 0));
        market.joinMarket{value: 0.05 ether}(0, 0);
    }

    function test_joinMarket_reverts_already_joined() public {
        market.createMarket{value: 1 ether}("Q?", 1 days);

        vm.deal(worker1, 1 ether);
        vm.startPrank(worker1);
        market.joinMarket{value: 0.05 ether}(0, 0);

        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.AlreadyJoined.selector, 0, worker1));
        market.joinMarket{value: 0.05 ether}(0, 0);
        vm.stopPrank();
    }

    // ─── resolveMarket ─────────────────────────────────────────────────

    function _setupMarketWith2Workers() internal returns (uint256 marketId) {
        marketId = market.createMarket{value: 1 ether}("Q?", 1 days);

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        market.joinMarket{value: 0.05 ether}(marketId, 0);

        vm.deal(worker2, 1 ether);
        vm.prank(worker2);
        market.joinMarket{value: 0.05 ether}(marketId, 0);
    }

    function test_resolveMarket_happy_path() public {
        uint256 id = _setupMarketWith2Workers();

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;

        uint256[] memory weights = new uint256[](2);
        weights[0] = 7000;
        weights[1] = 3000;

        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 90; // worker1
        dimScores[3] = 60; dimScores[4] = 50; dimScores[5] = 70; // worker2

        vm.prank(resolver);
        market.resolveMarket(id, workers, weights, dimScores, true);

        // worker1 gets 70% of 1 ether = 0.7 ether + 0.05 stake
        assertEq(market.balances(worker1), 0.7 ether + 0.05 ether);
        // worker2 gets 30% of 1 ether = 0.3 ether + 0.05 stake
        assertEq(market.balances(worker2), 0.3 ether + 0.05 ether);

        // Market is resolved
        CREsolverMarket.Market memory m = market.getMarket(id);
        assertTrue(m.resolved);
    }

    function test_resolveMarket_returns_stakes() public {
        uint256 id = _setupMarketWith2Workers();

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;

        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;

        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 90;
        dimScores[3] = 80; dimScores[4] = 70; dimScores[5] = 90;

        vm.prank(resolver);
        market.resolveMarket(id, workers, weights, dimScores, true);

        // Each worker gets 0.5 ether reward + 0.05 stake back
        assertEq(market.balances(worker1), 0.55 ether);
        assertEq(market.balances(worker2), 0.55 ether);

        // Stakes are zeroed out
        assertEq(market.stakes(id, worker1), 0);
        assertEq(market.stakes(id, worker2), 0);
    }

    function test_resolveMarket_publishes_reputation() public {
        // Reputation publishing to ERC-8004 is tested in
        // test_resolveMarket_publishes_erc8004_feedback.
        // Here we verify internal reputation averages are updated even when
        // external registry is disabled.
        uint256 id = _setupMarketWith2Workers();

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;

        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;

        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 60;
        dimScores[3] = 90; dimScores[4] = 85; dimScores[5] = 75;

        vm.prank(resolver);
        market.resolveMarket(id, workers, weights, dimScores, true);

        // Verify market resolved and rewards distributed correctly
        CREsolverMarket.Market memory m = market.getMarket(id);
        assertTrue(m.resolved);
        assertEq(market.balances(worker1), 0.5 ether + 0.05 ether);
        assertEq(market.balances(worker2), 0.5 ether + 0.05 ether);

        (uint256 w1ResQ, uint256 w1SrcQ, uint256 w1Depth, uint256 w1Count) = market.getReputation(worker1);
        assertEq(w1ResQ, 80);
        assertEq(w1SrcQ, 70);
        assertEq(w1Depth, 60);
        assertEq(w1Count, 1);

        (uint256 w2ResQ, uint256 w2SrcQ, uint256 w2Depth, uint256 w2Count) = market.getReputation(worker2);
        assertEq(w2ResQ, 90);
        assertEq(w2SrcQ, 85);
        assertEq(w2Depth, 75);
        assertEq(w2Count, 1);
    }

    function test_resolveMarket_reverts_unauthorized() public {
        uint256 id = _setupMarketWith2Workers();

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        uint8[] memory dimScores = new uint8[](6);

        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.Unauthorized.selector, nobody));
        market.resolveMarket(id, workers, weights, dimScores, true);
    }

    function test_resolveMarket_reverts_already_resolved() public {
        uint256 id = _setupMarketWith2Workers();

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 60;
        dimScores[3] = 90; dimScores[4] = 85; dimScores[5] = 75;

        vm.prank(resolver);
        market.resolveMarket(id, workers, weights, dimScores, true);

        // Second call should revert
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.AlreadyResolved.selector, id));
        market.resolveMarket(id, workers, weights, dimScores, true);
    }

    function test_resolveMarket_reverts_too_many_workers() public {
        market.createMarket{value: 1 ether}("Q?", 1 days);

        // Create 11 workers
        address[] memory workers = new address[](11);
        uint256[] memory weights = new uint256[](11);
        uint8[] memory dimScores = new uint8[](33);
        for (uint256 i; i < 11; i++) {
            workers[i] = address(uint160(100 + i));
            weights[i] = 1000;
            vm.deal(workers[i], 1 ether);
            vm.prank(workers[i]);
            market.joinMarket{value: 0.05 ether}(0, 0);
        }

        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.TooManyWorkers.selector, 11, 10));
        market.resolveMarket(0, workers, weights, dimScores, true);
    }

    function test_resolveMarket_reverts_array_mismatch() public {
        uint256 id = _setupMarketWith2Workers();

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;
        uint256[] memory weights = new uint256[](1); // mismatch
        weights[0] = 10000;
        uint8[] memory dimScores = new uint8[](6);

        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.ArrayMismatch.selector, 2, 1, 6));
        market.resolveMarket(id, workers, weights, dimScores, true);
    }

    function test_resolveMarket_reverts_unregistered_worker() public {
        market.createMarket{value: 1 ether}("Q?", 1 days);

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        market.joinMarket{value: 0.05 ether}(0, 0);

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker3; // not joined
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        uint8[] memory dimScores = new uint8[](6);

        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.UnregisteredWorker.selector, 0, worker3));
        market.resolveMarket(0, workers, weights, dimScores, true);
    }

    // ─── withdraw ──────────────────────────────────────────────────────

    function test_withdraw() public {
        uint256 id = _setupMarketWith2Workers();

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 60;
        dimScores[3] = 90; dimScores[4] = 85; dimScores[5] = 75;

        vm.prank(resolver);
        market.resolveMarket(id, workers, weights, dimScores, true);

        uint256 balBefore = worker1.balance;

        vm.prank(worker1);
        market.withdraw();

        assertEq(worker1.balance, balBefore + 0.55 ether);
        assertEq(market.balances(worker1), 0);
    }

    function test_withdraw_reverts_no_balance() public {
        vm.prank(worker1);
        vm.expectRevert(CREsolverMarket.NoBalance.selector);
        market.withdraw();
    }

    // ─── requestResolution ─────────────────────────────────────────────

    function test_requestResolution_by_creator() public {
        market.createMarket{value: 1 ether}("Will ETH hit 10k?", 1 days);

        vm.expectEmit(true, false, false, true);
        emit CREsolverMarket.ResolutionRequested(0, "Will ETH hit 10k?");

        market.requestResolution(0);
    }

    function test_requestResolution_by_owner() public {
        // Create market as worker1 (not the test contract)
        vm.deal(worker1, 2 ether);
        vm.prank(worker1);
        market.createMarket{value: 1 ether}("Q?", 1 days);

        // Owner (address(this)) should also be able to request resolution
        market.requestResolution(0);
    }

    function test_requestResolution_reverts_nonexistent_market() public {
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.MarketDoesNotExist.selector, 99));
        market.requestResolution(99);
    }

    function test_requestResolution_reverts_already_resolved() public {
        uint256 id = _setupMarketWith2Workers();

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 60;
        dimScores[3] = 90; dimScores[4] = 85; dimScores[5] = 75;

        vm.prank(resolver);
        market.resolveMarket(id, workers, weights, dimScores, true);

        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.MarketAlreadyResolved.selector, id));
        market.requestResolution(id);
    }

    function test_requestResolution_reverts_unauthorized_caller() public {
        market.createMarket{value: 1 ether}("Q?", 1 days);

        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.NotMarketCreator.selector, 0, nobody));
        market.requestResolution(0);
    }

    // ─── reputation accumulates ────────────────────────────────────────

    function test_reputation_accumulates() public {
        // Verify workers accumulate internal reputation across markets.

        // Market 1
        uint256 id1 = _setupMarketWith2Workers();

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        uint8[] memory dimScores1 = new uint8[](6);
        dimScores1[0] = 80; dimScores1[1] = 60; dimScores1[2] = 40;
        dimScores1[3] = 70; dimScores1[4] = 50; dimScores1[5] = 30;

        vm.prank(resolver);
        market.resolveMarket(id1, workers, weights, dimScores1, true);

        // Verify market 1 rewards: each worker gets 50% of 1 ether + 0.05 stake
        assertEq(market.balances(worker1), 0.55 ether);
        assertEq(market.balances(worker2), 0.55 ether);

        // Withdraw first so workers can re-stake
        vm.prank(worker1);
        market.withdraw();
        vm.prank(worker2);
        market.withdraw();

        // Market 2
        uint256 id2 = market.createMarket{value: 2 ether}("Q2?", 1 days);

        vm.prank(worker1);
        market.joinMarket{value: 0.05 ether}(id2, 0);
        vm.prank(worker2);
        market.joinMarket{value: 0.05 ether}(id2, 0);

        uint8[] memory dimScores2 = new uint8[](6);
        dimScores2[0] = 100; dimScores2[1] = 80; dimScores2[2] = 60;
        dimScores2[3] = 90;  dimScores2[4] = 70; dimScores2[5] = 50;

        vm.prank(resolver);
        market.resolveMarket(id2, workers, weights, dimScores2, true);

        // Verify market 2 rewards: each worker gets 50% of 2 ether + 0.05 stake
        assertEq(market.balances(worker1), 1.05 ether);
        assertEq(market.balances(worker2), 1.05 ether);

        // Both markets resolved
        assertTrue(market.getMarket(id1).resolved);
        assertTrue(market.getMarket(id2).resolved);

        (uint256 w1ResQ, uint256 w1SrcQ, uint256 w1Depth, uint256 w1Count) = market.getReputation(worker1);
        assertEq(w1ResQ, 90); // (80 + 100) / 2
        assertEq(w1SrcQ, 70); // (60 + 80) / 2
        assertEq(w1Depth, 50); // (40 + 60) / 2
        assertEq(w1Count, 2);

        (uint256 w2ResQ, uint256 w2SrcQ, uint256 w2Depth, uint256 w2Count) = market.getReputation(worker2);
        assertEq(w2ResQ, 80); // (70 + 90) / 2
        assertEq(w2SrcQ, 60); // (50 + 70) / 2
        assertEq(w2Depth, 40); // (30 + 50) / 2
        assertEq(w2Count, 2);
    }

    // ─── ERC-8004 Identity Registry ─────────────────────────────────

    function test_joinMarket_with_identity_registry() public {
        address mockIdentity = makeAddr("identityRegistry");
        CREsolverMarket marketWithId = new CREsolverMarket(mockIdentity, address(0));
        marketWithId.setAuthorizedResolver(resolver, true);
        marketWithId.createMarket{value: 1 ether}("Q?", 1 days);

        // Mock isAuthorizedOrOwner to return true for worker1 with agentId=42
        vm.mockCall(
            mockIdentity,
            abi.encodeWithSelector(bytes4(keccak256("isAuthorizedOrOwner(address,uint256)")), worker1, uint256(42)),
            abi.encode(true)
        );

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        marketWithId.joinMarket{value: 0.05 ether}(0, 42);

        assertEq(marketWithId.stakes(0, worker1), 0.05 ether);
        assertEq(marketWithId.workerAgentIds(0, worker1), 42);
    }

    function test_joinMarket_reverts_not_agent_owner() public {
        address mockIdentity = makeAddr("identityRegistry");
        CREsolverMarket marketWithId = new CREsolverMarket(mockIdentity, address(0));
        marketWithId.createMarket{value: 1 ether}("Q?", 1 days);

        // Mock isAuthorizedOrOwner to return false
        vm.mockCall(
            mockIdentity,
            abi.encodeWithSelector(bytes4(keccak256("isAuthorizedOrOwner(address,uint256)")), worker1, uint256(99)),
            abi.encode(false)
        );

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.NotAgentOwner.selector, worker1, 99));
        marketWithId.joinMarket{value: 0.05 ether}(0, 99);
    }

    function test_resolveMarket_publishes_erc8004_feedback() public {
        address mockIdentity = makeAddr("identityRegistry");
        address mockReputation = makeAddr("reputationRegistry");
        CREsolverMarket marketWithRep = new CREsolverMarket(mockIdentity, mockReputation);
        marketWithRep.setAuthorizedResolver(resolver, true);
        marketWithRep.createMarket{value: 1 ether}("Q?", 1 days);

        // Mock identity checks
        vm.mockCall(
            mockIdentity,
            abi.encodeWithSelector(bytes4(keccak256("isAuthorizedOrOwner(address,uint256)"))),
            abi.encode(true)
        );

        // Workers join with agent IDs
        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        marketWithRep.joinMarket{value: 0.05 ether}(0, 10);

        vm.deal(worker2, 1 ether);
        vm.prank(worker2);
        marketWithRep.joinMarket{value: 0.05 ether}(0, 20);

        // Mock giveFeedback calls
        vm.mockCall(
            mockReputation,
            abi.encodeWithSelector(bytes4(keccak256("giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)"))),
            abi.encode()
        );

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;

        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;

        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 60;
        dimScores[3] = 90; dimScores[4] = 85; dimScores[5] = 75;

        // The contract makes 3 separate giveFeedback calls per worker (one per dimension).
        // Worker1 scores: resQuality=80, srcQuality=70, analysisDepth=60
        vm.expectCall(
            mockReputation,
            abi.encodeCall(
                IERC8004Reputation.giveFeedback,
                (10, int128(80), 0, "resolution_quality", "cresolver", "", "", bytes32(0))
            )
        );
        vm.expectCall(
            mockReputation,
            abi.encodeCall(
                IERC8004Reputation.giveFeedback,
                (10, int128(70), 0, "source_quality", "cresolver", "", "", bytes32(0))
            )
        );
        vm.expectCall(
            mockReputation,
            abi.encodeCall(
                IERC8004Reputation.giveFeedback,
                (10, int128(60), 0, "analysis_depth", "cresolver", "", "", bytes32(0))
            )
        );
        // Worker2 scores: resQuality=90, srcQuality=85, analysisDepth=75
        vm.expectCall(
            mockReputation,
            abi.encodeCall(
                IERC8004Reputation.giveFeedback,
                (20, int128(90), 0, "resolution_quality", "cresolver", "", "", bytes32(0))
            )
        );
        vm.expectCall(
            mockReputation,
            abi.encodeCall(
                IERC8004Reputation.giveFeedback,
                (20, int128(85), 0, "source_quality", "cresolver", "", "", bytes32(0))
            )
        );
        vm.expectCall(
            mockReputation,
            abi.encodeCall(
                IERC8004Reputation.giveFeedback,
                (20, int128(75), 0, "analysis_depth", "cresolver", "", "", bytes32(0))
            )
        );

        vm.prank(resolver);
        marketWithRep.resolveMarket(0, workers, weights, dimScores, true);
    }
}

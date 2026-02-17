// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";

contract CREsolverMarketTest is Test {
    CREsolverMarket public market;

    address owner = address(this);
    address resolver = makeAddr("resolver");
    address worker1 = makeAddr("worker1");
    address worker2 = makeAddr("worker2");
    address worker3 = makeAddr("worker3");

    function setUp() public {
        market = new CREsolverMarket();
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
        market.joinMarket{value: 0.05 ether}(0);

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
        market.joinMarket{value: 0.001 ether}(0);
    }

    function test_joinMarket_reverts_market_not_active() public {
        market.createMarket{value: 1 ether}("Q?", 1 days);

        // Warp past deadline
        vm.warp(block.timestamp + 2 days);

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.MarketNotActive.selector, 0));
        market.joinMarket{value: 0.05 ether}(0);
    }

    function test_joinMarket_reverts_already_joined() public {
        market.createMarket{value: 1 ether}("Q?", 1 days);

        vm.deal(worker1, 1 ether);
        vm.startPrank(worker1);
        market.joinMarket{value: 0.05 ether}(0);

        vm.expectRevert(abi.encodeWithSelector(CREsolverMarket.AlreadyJoined.selector, 0, worker1));
        market.joinMarket{value: 0.05 ether}(0);
        vm.stopPrank();
    }

    // ─── resolveMarket ─────────────────────────────────────────────────

    function _setupMarketWith2Workers() internal returns (uint256 marketId) {
        marketId = market.createMarket{value: 1 ether}("Q?", 1 days);

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        market.joinMarket{value: 0.05 ether}(marketId);

        vm.deal(worker2, 1 ether);
        vm.prank(worker2);
        market.joinMarket{value: 0.05 ether}(marketId);
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

        (uint256 r1, uint256 s1, uint256 a1, uint256 c1) = market.getReputation(worker1);
        assertEq(r1, 80);
        assertEq(s1, 70);
        assertEq(a1, 60);
        assertEq(c1, 1);

        (uint256 r2, uint256 s2, uint256 a2, uint256 c2) = market.getReputation(worker2);
        assertEq(r2, 90);
        assertEq(s2, 85);
        assertEq(a2, 75);
        assertEq(c2, 1);
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
            market.joinMarket{value: 0.05 ether}(0);
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
        market.joinMarket{value: 0.05 ether}(0);

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

    // ─── reputation accumulates ────────────────────────────────────────

    function test_reputation_accumulates() public {
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

        // Withdraw first so workers can re-stake
        vm.prank(worker1);
        market.withdraw();
        vm.prank(worker2);
        market.withdraw();

        // Market 2
        uint256 id2 = market.createMarket{value: 2 ether}("Q2?", 1 days);

        vm.prank(worker1);
        market.joinMarket{value: 0.05 ether}(id2);
        vm.prank(worker2);
        market.joinMarket{value: 0.05 ether}(id2);

        uint8[] memory dimScores2 = new uint8[](6);
        dimScores2[0] = 100; dimScores2[1] = 80; dimScores2[2] = 60;
        dimScores2[3] = 90;  dimScores2[4] = 70; dimScores2[5] = 50;

        vm.prank(resolver);
        market.resolveMarket(id2, workers, weights, dimScores2, true);

        // Worker1: avg = (80+100)/2=90, (60+80)/2=70, (40+60)/2=50
        (uint256 r1, uint256 s1, uint256 a1, uint256 c1) = market.getReputation(worker1);
        assertEq(r1, 90);
        assertEq(s1, 70);
        assertEq(a1, 50);
        assertEq(c1, 2);

        // Worker2: avg = (70+90)/2=80, (50+70)/2=60, (30+50)/2=40
        (uint256 r2, uint256 s2, uint256 a2, uint256 c2) = market.getReputation(worker2);
        assertEq(r2, 80);
        assertEq(s2, 60);
        assertEq(a2, 40);
        assertEq(c2, 2);
    }
}

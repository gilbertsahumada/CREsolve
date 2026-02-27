// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BinaryMarket} from "../src/BinaryMarket.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";
import {Market} from "../src/lib/CREsolverMarketTypes.sol";

contract BinaryMarketTest is Test {
    CREsolverMarket public core;
    BinaryMarket public binary;

    address mockIdentity = makeAddr("mockIdentityRegistry");
    address mockReputation = makeAddr("mockReputationRegistry");
    address resolver = makeAddr("resolver");

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address settler = makeAddr("settler");

    function setUp() public {
        core = new CREsolverMarket(mockIdentity, mockReputation);
        binary = new BinaryMarket(address(core));

        vm.mockCall(
            mockIdentity,
            abi.encodeWithSelector(bytes4(keccak256("isAuthorizedOrOwner(address,uint256)"))),
            abi.encode(true)
        );
        core.setAuthorizedResolver(resolver, true);

        // Fund test accounts
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(charlie, 10 ether);
        vm.deal(settler, 1 ether);
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    function _createAndPopulateMarket() internal returns (uint256 marketId) {
        marketId = core.createMarket{value: 0.1 ether}("Will ETH hit 10k?", 1 days);

        // Two workers join so we can resolve later
        address worker1 = makeAddr("worker1");
        address worker2 = makeAddr("worker2");
        vm.deal(worker1, 1 ether);
        vm.deal(worker2, 1 ether);
        vm.prank(worker1);
        core.joinMarket{value: 0.001 ether}(marketId, 0);
        vm.prank(worker2);
        core.joinMarket{value: 0.001 ether}(marketId, 0);
    }

    function _resolveMarket(uint256 marketId, bool resolution) internal {
        address worker1 = makeAddr("worker1");
        address worker2 = makeAddr("worker2");

        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 60;
        dimScores[3] = 80; dimScores[4] = 70; dimScores[5] = 60;

        vm.prank(resolver);
        core.resolveMarket(marketId, workers, weights, dimScores, resolution);
    }

    // ─── buyYes / buyNo ─────────────────────────────────────────────────

    function test_buyYes() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);

        (uint256 yesTotal, uint256 noTotal,,) = binary.getPool(id);
        assertEq(yesTotal, 1 ether);
        assertEq(noTotal, 0);

        (uint256 yesAmt, uint256 noAmt) = binary.getUserPosition(id, alice);
        assertEq(yesAmt, 1 ether);
        assertEq(noAmt, 0);
    }

    function test_buyNo() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(bob);
        binary.buyNo{value: 2 ether}(id);

        (uint256 yesTotal, uint256 noTotal,,) = binary.getPool(id);
        assertEq(yesTotal, 0);
        assertEq(noTotal, 2 ether);

        (uint256 yesAmt, uint256 noAmt) = binary.getUserPosition(id, bob);
        assertEq(yesAmt, 0);
        assertEq(noAmt, 2 ether);
    }

    function test_multipleBets() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);
        vm.prank(alice);
        binary.buyYes{value: 0.5 ether}(id);

        (uint256 yesAmt,) = binary.getUserPosition(id, alice);
        assertEq(yesAmt, 1.5 ether);
    }

    function test_buyReverts_zeroValue() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        vm.expectRevert("Must send ETH");
        binary.buyYes{value: 0}(id);
    }

    function test_buyReverts_nonexistentMarket() public {
        vm.prank(alice);
        vm.expectRevert("Market does not exist");
        binary.buyYes{value: 1 ether}(99);
    }

    function test_buyReverts_expiredMarket() public {
        uint256 id = _createAndPopulateMarket();
        vm.warp(block.timestamp + 2 days);

        vm.prank(alice);
        vm.expectRevert("Market expired");
        binary.buyYes{value: 1 ether}(id);
    }

    function test_buyReverts_resolvedMarket() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);

        _resolveMarket(id, true);

        vm.prank(bob);
        vm.expectRevert("Market already resolved");
        binary.buyYes{value: 1 ether}(id);
    }

    // ─── settle ─────────────────────────────────────────────────────────

    function test_settle_yesWins() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 3 ether}(id);
        vm.prank(bob);
        binary.buyNo{value: 1 ether}(id);

        _resolveMarket(id, true);

        vm.prank(settler);
        binary.settle(id);

        (,, bool settled, bool outcome) = binary.getPool(id);
        assertTrue(settled);
        assertTrue(outcome);

        // Fee = 4 ether * 1% = 0.04 ether
        assertEq(binary.balances(settler), 0.04 ether);
    }

    function test_settle_noWins() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);
        vm.prank(bob);
        binary.buyNo{value: 3 ether}(id);

        _resolveMarket(id, false);

        vm.prank(settler);
        binary.settle(id);

        (,, bool settled, bool outcome) = binary.getPool(id);
        assertTrue(settled);
        assertFalse(outcome);
    }

    function test_settleReverts_notResolved() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);

        vm.prank(settler);
        vm.expectRevert("Market not resolved yet");
        binary.settle(id);
    }

    function test_settleReverts_alreadySettled() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);

        _resolveMarket(id, true);

        vm.prank(settler);
        binary.settle(id);

        vm.prank(settler);
        vm.expectRevert("Already settled");
        binary.settle(id);
    }

    // ─── claim ──────────────────────────────────────────────────────────

    function test_claim_yesWinner() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 3 ether}(id);
        vm.prank(bob);
        binary.buyNo{value: 1 ether}(id);

        _resolveMarket(id, true);

        vm.prank(settler);
        binary.settle(id);

        vm.prank(alice);
        binary.claim(id);

        // Total pool = 4 ether, fee = 0.04 ether, net = 3.96 ether
        // Alice is only YES bettor (3/3) so gets all 3.96 ether
        assertEq(binary.balances(alice), 3.96 ether);
    }

    function test_claim_proportional() public {
        uint256 id = _createAndPopulateMarket();

        // Two YES bettors
        vm.prank(alice);
        binary.buyYes{value: 3 ether}(id);
        vm.prank(charlie);
        binary.buyYes{value: 1 ether}(id);

        // One NO bettor
        vm.prank(bob);
        binary.buyNo{value: 4 ether}(id);

        _resolveMarket(id, true);

        vm.prank(settler);
        binary.settle(id);

        // Total = 8 ether, fee = 0.08, net = 7.92
        // Alice: (3/4) * 7.92 = 5.94
        // Charlie: (1/4) * 7.92 = 1.98
        vm.prank(alice);
        binary.claim(id);
        assertEq(binary.balances(alice), 5.94 ether);

        vm.prank(charlie);
        binary.claim(id);
        assertEq(binary.balances(charlie), 1.98 ether);
    }

    function test_claimReverts_notSettled() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);

        vm.prank(alice);
        vm.expectRevert("Not settled yet");
        binary.claim(id);
    }

    function test_claimReverts_noWinningPosition() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);
        vm.prank(bob);
        binary.buyNo{value: 1 ether}(id);

        _resolveMarket(id, false); // NO wins

        vm.prank(settler);
        binary.settle(id);

        // Alice bet YES, NO won → no winning position
        vm.prank(alice);
        vm.expectRevert("No winning position");
        binary.claim(id);
    }

    function test_claimReverts_doubleClaim() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);
        vm.prank(bob);
        binary.buyNo{value: 1 ether}(id);

        _resolveMarket(id, true);

        vm.prank(settler);
        binary.settle(id);

        vm.prank(alice);
        binary.claim(id);

        vm.prank(alice);
        vm.expectRevert("No winning position");
        binary.claim(id);
    }

    // ─── withdraw ───────────────────────────────────────────────────────

    function test_withdraw() public {
        uint256 id = _createAndPopulateMarket();

        vm.prank(alice);
        binary.buyYes{value: 1 ether}(id);
        vm.prank(bob);
        binary.buyNo{value: 1 ether}(id);

        _resolveMarket(id, true);

        vm.prank(settler);
        binary.settle(id);

        vm.prank(alice);
        binary.claim(id);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        binary.withdraw();
        assertGt(alice.balance, balBefore);
        assertEq(binary.balances(alice), 0);
    }

    function test_withdrawReverts_noBalance() public {
        vm.prank(alice);
        vm.expectRevert("No balance");
        binary.withdraw();
    }

    // ─── Constructor ────────────────────────────────────────────────────

    function test_constructorReverts_zeroAddress() public {
        vm.expectRevert("Zero address");
        new BinaryMarket(address(0));
    }
}

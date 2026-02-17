// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CREReceiver} from "../src/CREReceiver.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";

contract CREReceiverTest is Test {
    CREsolverMarket public market;
    CREReceiver public receiver;

    address forwarder = makeAddr("forwarder");
    address worker1 = makeAddr("worker1");
    address worker2 = makeAddr("worker2");

    function setUp() public {
        market = new CREsolverMarket();
        receiver = new CREReceiver(address(market), forwarder);

        // Authorize the receiver as a resolver on the market
        market.setAuthorizedResolver(address(receiver), true);

        // Create a market and have workers join
        market.createMarket{value: 1 ether}("Test question?", 1 days);

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        market.joinMarket{value: 0.05 ether}(0);

        vm.deal(worker2, 1 ether);
        vm.prank(worker2);
        market.joinMarket{value: 0.05 ether}(0);
    }

    function test_onReport_happy_path() public {
        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;

        uint256[] memory weights = new uint256[](2);
        weights[0] = 6000;
        weights[1] = 4000;

        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 60;
        dimScores[3] = 90; dimScores[4] = 85; dimScores[5] = 75;

        bytes memory report = abi.encode(uint256(0), workers, weights, dimScores, true);
        bytes memory metadata = abi.encode(bytes32("workflow123"));

        vm.prank(forwarder);
        receiver.onReport(metadata, report);

        // Verify market was resolved
        CREsolverMarket.Market memory m = market.getMarket(0);
        assertTrue(m.resolved);

        // Verify rewards distributed
        assertEq(market.balances(worker1), 0.6 ether + 0.05 ether);
        assertEq(market.balances(worker2), 0.4 ether + 0.05 ether);
    }

    function test_onReport_reverts_unauthorized_forwarder() public {
        bytes memory report = abi.encode(uint256(0), new address[](0), new uint256[](0), new uint8[](0), true);
        bytes memory metadata = "";

        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(CREReceiver.UnauthorizedForwarder.selector, nobody));
        receiver.onReport(metadata, report);
    }

    function test_onReport_emits_event() public {
        address[] memory workers = new address[](2);
        workers[0] = worker1;
        workers[1] = worker2;

        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;

        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = 80; dimScores[1] = 70; dimScores[2] = 60;
        dimScores[3] = 90; dimScores[4] = 85; dimScores[5] = 75;

        bytes memory report = abi.encode(uint256(0), workers, weights, dimScores, true);
        bytes32 wfId = bytes32("workflow456");
        bytes memory metadata = abi.encode(wfId);

        vm.expectEmit(true, true, false, false);
        emit CREReceiver.ReportReceived(wfId, 0);

        vm.prank(forwarder);
        receiver.onReport(metadata, report);
    }

    function test_setKeystoneForwarder_only_owner() public {
        address newForwarder = makeAddr("newForwarder");

        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert();
        receiver.setKeystoneForwarder(newForwarder);
    }

    function test_setKeystoneForwarder_updates() public {
        address newForwarder = makeAddr("newForwarder");

        vm.expectEmit(true, true, false, false);
        emit CREReceiver.ForwarderUpdated(forwarder, newForwarder);

        receiver.setKeystoneForwarder(newForwarder);

        assertEq(receiver.keystoneForwarder(), newForwarder);
    }
}

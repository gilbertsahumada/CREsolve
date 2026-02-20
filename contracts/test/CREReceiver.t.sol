// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CREReceiver} from "../src/CREReceiver.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";
import {Market} from "../src/lib/CREsolverMarketTypes.sol";
import {ReceiverTemplate} from "../src/interfaces/ReceiverTemplate.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract CREReceiverTest is Test {
    CREsolverMarket public market;
    CREReceiver public receiver;

    address mockIdentity = makeAddr("mockIdentityRegistry");
    address mockReputation = makeAddr("mockReputationRegistry");

    address forwarder = makeAddr("forwarder");
    address worker1 = makeAddr("worker1");
    address worker2 = makeAddr("worker2");

    // Valid metadata: workflowId (32 bytes) + donId (32 bytes)
    bytes32 constant WORKFLOW_ID = bytes32("cresolver-resolution");
    bytes32 constant DON_ID = bytes32("don-1");

    function _validMetadata() internal pure returns (bytes memory) {
        return abi.encodePacked(WORKFLOW_ID, DON_ID);
    }

    function setUp() public {
        market = new CREsolverMarket(mockIdentity, mockReputation);
        vm.mockCall(
            mockIdentity,
            abi.encodeWithSelector(bytes4(keccak256("isAuthorizedOrOwner(address,uint256)"))),
            abi.encode(true)
        );
        receiver = new CREReceiver(address(market), forwarder);

        // Authorize the receiver as a resolver on the market
        market.setAuthorizedResolver(address(receiver), true);

        // Create a market and have workers join
        market.createMarket{value: 1 ether}("Test question?", 1 days);

        vm.deal(worker1, 1 ether);
        vm.prank(worker1);
        market.joinMarket{value: 0.05 ether}(0, 0);

        vm.deal(worker2, 1 ether);
        vm.prank(worker2);
        market.joinMarket{value: 0.05 ether}(0, 0);
    }

    // ─── Happy path ──────────────────────────────────────────────────

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
        bytes memory metadata = _validMetadata();

        vm.prank(forwarder);
        receiver.onReport(metadata, report);

        // Verify market was resolved
        Market memory m = market.getMarket(0);
        assertTrue(m.resolved);

        // Verify rewards distributed
        assertEq(market.balances(worker1), 0.6 ether + 0.05 ether);
        assertEq(market.balances(worker2), 0.4 ether + 0.05 ether);
    }

    // ─── Forwarder validation ────────────────────────────────────────

    function test_onReport_reverts_unauthorized_forwarder() public {
        bytes memory report = abi.encode(uint256(0), new address[](0), new uint256[](0), new uint8[](0), true);
        bytes memory metadata = _validMetadata();

        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.UnauthorizedForwarder.selector, nobody));
        receiver.onReport(metadata, report);
    }

    // ─── Metadata validation ─────────────────────────────────────────

    function test_onReport_reverts_short_metadata() public {
        bytes memory report = abi.encode(uint256(0), new address[](0), new uint256[](0), new uint8[](0), true);
        bytes memory shortMetadata = abi.encodePacked(bytes32("short")); // only 32 bytes, need 64

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.MetadataTooShort.selector, 32));
        receiver.onReport(shortMetadata, report);
    }

    // ─── Event emission ──────────────────────────────────────────────

    function test_onReport_emits_ReportProcessed() public {
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
        bytes memory metadata = _validMetadata();

        vm.expectEmit(true, true, false, false);
        emit ReceiverTemplate.ReportProcessed(WORKFLOW_ID, DON_ID);

        vm.prank(forwarder);
        receiver.onReport(metadata, report);
    }

    function test_onReport_emits_ReportReceived() public {
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
        bytes memory metadata = _validMetadata();

        vm.expectEmit(true, true, false, false);
        emit CREReceiver.ReportReceived(bytes32(0), 0);

        vm.prank(forwarder);
        receiver.onReport(metadata, report);
    }

    // ─── Forwarder management ────────────────────────────────────────

    function test_setForwarder_only_owner() public {
        address newForwarder = makeAddr("newForwarder");

        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert();
        receiver.setForwarder(newForwarder);
    }

    function test_setForwarder_updates() public {
        address newForwarder = makeAddr("newForwarder");

        vm.expectEmit(true, true, false, false);
        emit ReceiverTemplate.ForwarderUpdated(forwarder, newForwarder);

        receiver.setForwarder(newForwarder);

        assertEq(receiver.forwarder(), newForwarder);
    }

    // ─── Workflow identity enforcement ───────────────────────────────

    function test_workflow_identity_enforcement() public {
        // Enable enforcement
        receiver.setEnforceWorkflowIdentity(true);

        bytes memory report = abi.encode(
            uint256(0),
            new address[](0),
            new uint256[](0),
            new uint8[](0),
            true
        );
        bytes memory metadata = _validMetadata();

        // Should revert because workflow is not allowed yet
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(ReceiverTemplate.UnauthorizedWorkflow.selector, WORKFLOW_ID, DON_ID)
        );
        receiver.onReport(metadata, report);

        // Allow the workflow
        receiver.allowWorkflow(WORKFLOW_ID, DON_ID, "cresolver");

        (bool isAllowed, string memory name) = receiver.isWorkflowAllowed(WORKFLOW_ID, DON_ID);
        assertTrue(isAllowed);
        assertEq(name, "cresolver");
    }

    // ─── ERC165 ──────────────────────────────────────────────────────

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertFalse(receiver.supportsInterface(bytes4(0xdeadbeef)));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";
import {Market} from "../src/lib/CREsolverMarketTypes.sol";
import {IERC8004IdentityV1} from "../src/interfaces/erc8004/IERC8004IdentityV1.sol";
import {NotAgentOwner} from "../src/lib/CREsolverMarketErrors.sol";

contract CREsolverMarketForkTest is Test {
    // Sepolia ERC-8004 registry addresses
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    // Deployed contract on Sepolia
    address constant DEPLOYED_MARKET = 0x499B178A5152Fb658dDbA1622B9B29Bb88561863;

    CREsolverMarket internal market;
    bool internal forkEnabled;

    address internal worker;
    uint256 internal workerAgentId;
    uint256 internal marketId;

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

        // Preconditions against real Sepolia registry.
        bool authorized = IERC8004IdentityV1(IDENTITY_REGISTRY).isAuthorizedOrOwner(
            worker,
            workerAgentId
        );
        require(authorized, "FORK_WORKER_ADDRESS is not authorized for FORK_AGENT_ID on Sepolia");

        vm.deal(address(this), 10 ether);
        market = new CREsolverMarket(IDENTITY_REGISTRY, REPUTATION_REGISTRY);
        marketId = market.createMarket{value: 1 ether}("Fork test market?", 1 days);
    }

    function test_inspect_deployed_market() public view {
        if (!forkEnabled) return;

        CREsolverMarket deployed = CREsolverMarket(DEPLOYED_MARKET);
        uint256 count = deployed.marketCount();
        console.log("=== Deployed CREsolverMarket ===");
        console.log("  Address:", DEPLOYED_MARKET);
        console.log("  Total markets:", count);

        for (uint256 i = 0; i < count; i++) {
            Market memory m = deployed.getMarket(i);
            address[] memory workers = deployed.getMarketWorkers(i);

            console.log("");
            console.log("  --- Market #%d ---", i);
            console.log("    Question:", m.question);
            console.log("    Reward pool: %d wei", m.rewardPool);
            console.log("    Deadline: %d", m.deadline);
            console.log("    Creator:", m.creator);
            console.log("    Resolved:", m.resolved ? "YES" : "NO");
            console.log("    Workers: %d", workers.length);

            for (uint256 j = 0; j < workers.length; j++) {
                uint256 stake = deployed.stakes(i, workers[j]);
                console.log("      [%d] %s (stake: %d wei)", j, workers[j], stake);
            }
        }
    }

    function test_joinMarket_with_real_identity_registry() public {
        if (!forkEnabled) return;

        vm.deal(worker, 1 ether);
        vm.prank(worker);
        market.joinMarket{value: 0.05 ether}(marketId, workerAgentId);

        assertEq(market.stakes(marketId, worker), 0.05 ether);
        assertEq(market.workerAgentIds(marketId, worker), workerAgentId);
    }

    function test_joinMarket_reverts_unauthorized_worker_on_fork() public {
        if (!forkEnabled) return;

        address unauthorizedWorker = makeAddr("unauthorizedWorker");
        vm.deal(unauthorizedWorker, 1 ether);

        vm.prank(unauthorizedWorker);
        vm.expectRevert(
            abi.encodeWithSelector(
                NotAgentOwner.selector,
                unauthorizedWorker,
                workerAgentId
            )
        );
        market.joinMarket{value: 0.05 ether}(marketId, workerAgentId);
    }
}

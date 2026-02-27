// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";
import {Market} from "../src/lib/CREsolverMarketTypes.sol";

/**
 * @title RequestResolution
 * @notice Calls requestResolution() on a CREsolverMarket market, emitting the
 *         ResolutionRequested event that triggers the CRE EVM Log Trigger.
 *
 * Required env:
 *   DEPLOYER_KEY   – private key of the caller (any address, needs gas)
 *   SEPOLIA_RPC    – RPC endpoint
 *   MARKET_ADDRESS – deployed CREsolverMarket address
 *   MARKET_ID      – market ID to request resolution for
 *
 * Usage:
 *   cd contracts
 *   source .env && MARKET_ID=1 forge script script/RequestResolution.s.sol \
 *     --rpc-url $SEPOLIA_RPC --broadcast -vvvv
 */
contract RequestResolutionScript is Script {
    function run() external {
        address marketAddr = vm.envAddress("MARKET_ADDRESS");
        uint256 marketId = vm.envUint("MARKET_ID");
        uint256 callerKey = vm.envUint("DEPLOYER_KEY");
        address caller = vm.addr(callerKey);

        CREsolverMarket market = CREsolverMarket(payable(marketAddr));

        // ── Inspect market state ────────────────────────────────────────
        Market memory m = market.getMarket(marketId);
        address[] memory workers = market.getMarketWorkers(marketId);

        console.log("=== Request Resolution ===");
        console.log("  Contract: %s", marketAddr);
        console.log("  Caller: %s", caller);
        console.log("");
        console.log("  Market #%d", marketId);
        console.log("    Question: %s", m.question);
        console.log("    Reward: %d wei", m.rewardPool);
        console.log("    Deadline: %d", m.deadline);
        console.log("    Resolved: %s", m.resolved ? "YES" : "NO");
        console.log("    Workers: %d", workers.length);

        require(m.deadline > 0, "Market does not exist");
        require(!m.resolved, "Market already resolved");

        // ── Send requestResolution tx ────────────────────────────────────
        vm.startBroadcast(callerKey);
        market.requestResolution(marketId);
        vm.stopBroadcast();

        console.log("");
        console.log("  ResolutionRequested event emitted!");
        console.log("  CRE workflow should pick this up via EVM Log Trigger.");
        console.log("========================================\n");
    }
}

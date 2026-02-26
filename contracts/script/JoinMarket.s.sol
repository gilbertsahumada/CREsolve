// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";

/**
 * @title JoinMarket
 * @notice Joins the 3 registered ERC-8004 agents to an existing market.
 *
 * Required env:
 *   DEPLOYER_KEY   – any funded key (not used for joining, only for gas estimation)
 *   SEPOLIA_RPC    – RPC endpoint
 *   MARKET_ADDRESS – deployed CREsolverMarket address
 *   MARKET_ID      – the market to join
 *
 * Optional env:
 *   STAKE_ETH      – worker stake in wei (default: 0.0001 ether)
 *
 * Usage:
 *   cd contracts
 *   source .env && MARKET_ID=8 forge script script/JoinMarket.s.sol \
 *     --rpc-url $SEPOLIA_RPC --broadcast -vvvv
 */
contract JoinMarketScript is Script {
    function run() external {
        address marketAddr = vm.envAddress("MARKET_ADDRESS");
        uint256 marketId = vm.envUint("MARKET_ID");
        uint256 stakeWei = vm.envOr("STAKE_ETH", uint256(0.0001 ether));

        CREsolverMarket market = CREsolverMarket(payable(marketAddr));

        // ── Read agents ───────────────────────────────────────────────────
        string memory json = vm.readFile("../scripts/sepolia-agents.json");
        require(bytes(json).length > 0, "sepolia-agents.json not found");

        console.log("=== Join Market #%d ===\n", marketId);
        console.log("  Contract: %s", marketAddr);
        console.log("  Stake per worker: %s wei\n", stakeWei);

        for (uint256 i = 0; i < 3; i++) {
            string memory base = string.concat(".agents[", vm.toString(i), "]");
            string memory name = vm.parseJsonString(json, string.concat(base, ".name"));
            uint256 agentId = vm.parseJsonUint(json, string.concat(base, ".agentId"));
            uint256 workerKey = vm.parseUint(vm.parseJsonString(json, string.concat(base, ".privateKey")));

            vm.startBroadcast(workerKey);
            market.joinMarket{value: stakeWei}(marketId, agentId);
            vm.stopBroadcast();

            console.log("  %s joined (agentId: %d)", name, agentId);
        }

        console.log("\n========================================");
        console.log("  3 workers joined market #%d", marketId);
        console.log("========================================\n");
    }
}

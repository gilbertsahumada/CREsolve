// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";

/**
 * @title SetupDemoMarkets
 * @notice Creates 8 demo markets for the frontend:
 *         - 3 with 1-minute duration (expire quickly → "Expired" in frontend)
 *         - 5 with varying durations (stay "Open" for demo)
 *         All markets get 3 workers auto-joined.
 *
 * Required env:
 *   DEPLOYER_KEY   – private key of the market creator (needs ETH)
 *   SEPOLIA_RPC    – RPC endpoint
 *   MARKET_ADDRESS – deployed CREsolverMarket address
 *
 * Usage:
 *   cd contracts
 *   source .env && forge script script/SetupDemoMarkets.s.sol \
 *     --rpc-url $SEPOLIA_RPC --broadcast -vvvv
 */
contract SetupDemoMarketsScript is Script {
    struct MarketDef {
        string question;
        uint256 durationSeconds;
    }

    function run() external {
        // ── Config ────────────────────────────────────────────────────────
        address marketAddr = vm.envAddress("MARKET_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");

        uint256 rewardWei = 0.001 ether;
        uint256 stakeWei = 0.0001 ether;

        CREsolverMarket market = CREsolverMarket(payable(marketAddr));

        // ── Read agents ───────────────────────────────────────────────────
        string memory json = vm.readFile("../scripts/sepolia-agents.json");
        require(bytes(json).length > 0, "sepolia-agents.json not found");

        address[3] memory workerAddrs;
        uint256[3] memory workerKeys;
        uint256[3] memory agentIds;

        for (uint256 i = 0; i < 3; i++) {
            string memory base = string.concat(".agents[", vm.toString(i), "]");
            workerAddrs[i] = vm.parseJsonAddress(json, string.concat(base, ".address"));
            agentIds[i] = vm.parseJsonUint(json, string.concat(base, ".agentId"));
            workerKeys[i] = vm.parseUint(vm.parseJsonString(json, string.concat(base, ".privateKey")));
        }

        // ── Market definitions ───────────────────────────────────────────
        MarketDef[8] memory markets;

        // Batch 1: 1-minute duration (will expire quickly)
        markets[0] = MarketDef("Will global AI chip demand exceed $500B by Q3 2026?", 60);
        markets[1] = MarketDef("Will SpaceX complete a successful Starship orbital refueling test in 2026?", 60);
        markets[2] = MarketDef("Will the EU pass comprehensive DeFi regulation before July 2026?", 60);

        // Batch 2: longer durations (stay open for demo)
        markets[3] = MarketDef("Will bitcoin reach 200k by end of 2026?", 1 days);
        markets[4] = MarketDef("Will Ethereum L2 total TVL surpass L1 TVL within 7 days?", 7 days);
        markets[5] = MarketDef("Will a central bank launch a retail CBDC on a public blockchain by March 2026?", 30 days);
        markets[6] = MarketDef("Will OpenAI release GPT-5 before June 2026?", 14 days);
        markets[7] = MarketDef("Will total crypto market cap surpass $5T in 2026?", 30 days);

        // ── Create all markets + join workers ────────────────────────────
        console.log("=== Creating 8 demo markets ===\n");

        for (uint256 m = 0; m < 8; m++) {
            // Create market
            vm.startBroadcast(deployerKey);
            uint256 id = market.createMarket{value: rewardWei}(
                markets[m].question,
                markets[m].durationSeconds
            );
            vm.stopBroadcast();

            console.log("Market #%d: %s", id, markets[m].question);
            console.log("  Duration: %d seconds", markets[m].durationSeconds);

            // Workers join
            for (uint256 w = 0; w < 3; w++) {
                vm.startBroadcast(workerKeys[w]);
                market.joinMarket{value: stakeWei}(id, agentIds[w]);
                vm.stopBroadcast();
            }
            console.log("  3 workers joined\n");
        }

        console.log("========================================");
        console.log("  8 demo markets created!");
        console.log("  Contract: %s", marketAddr);
        console.log("========================================\n");
    }
}

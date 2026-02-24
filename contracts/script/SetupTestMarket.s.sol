// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";

/**
 * @title SetupTestMarket
 * @notice Creates a new market on an already-deployed CREsolverMarket and has
 *         the 3 worker agents join it.  Use this to spin up fresh markets for
 *         testing without re-deploying the contracts.
 *
 * Required env:
 *   DEPLOYER_KEY   – private key of the market creator (needs ETH)
 *   SEPOLIA_RPC    – RPC endpoint
 *   MARKET_ADDRESS – deployed CREsolverMarket address
 *
 * Optional env (override defaults):
 *   QUESTION       – market question  (default: "Will bitcoin reach 200k by end of 2026?")
 *   REWARD_ETH     – reward pool in wei (default: 0.01 ether)
 *   DURATION       – market duration in seconds (default: 7 days)
 *   STAKE_ETH      – worker stake in wei (default: 0.0005 ether)
 *
 * Usage:
 *   cd contracts
 *   source .env && forge script script/SetupTestMarket.s.sol \
 *     --rpc-url $SEPOLIA_RPC --broadcast -vvvv
 */
contract SetupTestMarketScript is Script {
    function run() external {
        // ── Config ────────────────────────────────────────────────────────
        address marketAddr = vm.envAddress("MARKET_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);

        string memory question = vm.envOr("QUESTION", string("Will bitcoin reach 200k by end of 2026?"));
        uint256 rewardWei = vm.envOr("REWARD_ETH", uint256(0.01 ether));
        uint256 duration = vm.envOr("DURATION", uint256(7 days));
        uint256 stakeWei = vm.envOr("STAKE_ETH", uint256(0.0005 ether));

        CREsolverMarket market = CREsolverMarket(payable(marketAddr));

        // ── Read agents ───────────────────────────────────────────────────
        string memory json = vm.readFile("../scripts/sepolia-agents.json");
        require(bytes(json).length > 0, "sepolia-agents.json not found. Run `yarn sepolia:wallets` + `yarn sepolia:sync`.");

        address[3] memory workerAddrs;
        uint256[3] memory workerKeys;
        uint256[3] memory agentIds;
        string[3] memory names;

        for (uint256 i = 0; i < 3; i++) {
            string memory base = string.concat(".agents[", vm.toString(i), "]");
            names[i] = vm.parseJsonString(json, string.concat(base, ".name"));
            workerAddrs[i] = vm.parseJsonAddress(json, string.concat(base, ".address"));
            agentIds[i] = vm.parseJsonUint(json, string.concat(base, ".agentId"));
            workerKeys[i] = vm.parseUint(vm.parseJsonString(json, string.concat(base, ".privateKey")));
        }

        console.log("=== Setup Test Market ===");
        console.log("  Market contract: %s", marketAddr);
        console.log("  Creator: %s", deployer);
        console.log("  Question: %s", question);

        // ── Create market ─────────────────────────────────────────────────
        vm.startBroadcast(deployerKey);
        uint256 marketId = market.createMarket{value: rewardWei}(question, duration);
        vm.stopBroadcast();

        console.log("\n  Market #%d created (reward: %s wei, duration: %s s)", marketId, rewardWei, duration);

        // ── Workers join ──────────────────────────────────────────────────
        console.log("\n=== Workers joining ===");
        for (uint256 i = 0; i < 3; i++) {
            vm.startBroadcast(workerKeys[i]);
            market.joinMarket{value: stakeWei}(marketId, agentIds[i]);
            vm.stopBroadcast();
            console.log("  %s joined (agentId: %d, stake: %s wei)", names[i], agentIds[i], stakeWei);
        }

        // ── Summary ───────────────────────────────────────────────────────
        console.log("\n========================================");
        console.log("  Market #%d ready for resolution!", marketId);
        console.log("========================================");
        console.log("  Contract: %s", marketAddr);
        console.log("  Workers: 3");
        console.log("  Payload: {\"market_id\": %d}", marketId);
        console.log("========================================\n");
    }
}

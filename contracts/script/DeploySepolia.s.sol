// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";

/**
 * @title DeploySepolia
 * @notice Deploys CREsolverMarket on Sepolia with ERC-8004 registries,
 *         creates a test market, and has workers join with their agentIds.
 *
 * Prerequisites:
 *   1. Run `yarn generate-wallets` to create worker wallets
 *   2. Run `DEPLOYER_KEY=0x... SEPOLIA_RPC=... yarn register-agents` to register on ERC-8004
 *   3. Ensure workers are funded (register-agents does this)
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_KEY=0x... forge script script/DeploySepolia.s.sol \
 *     --rpc-url $SEPOLIA_RPC --broadcast -vvvv
 */
contract DeploySepoliaScript is Script {
    function run() external {
        // Sepolia/Testnets ERC-8004 addresses (overridable via env)
        address IDENTITY_REGISTRY = vm.envOr("ERC8004_IDENTITY", 0x8004A818BFB912233c491871b3d84c89A494BD9e);
        address REPUTATION_REGISTRY = vm.envOr("ERC8004_REPUTATION", 0x8004B663056A597Dffe9eCcC1965A193B7388713);

        // ── Read sepolia-agents.json ─────────────────────────────────────
        string memory json = vm.readFile("../scripts/sepolia-agents.json");

        if(bytes(json).length == 0) {
            revert("sepolia-agents.json not found or empty. Please run `yarn generate-wallets` and `yarn register-agents` first.");
        }

        // Parse 3 agents
        address[3] memory workerAddrs;
        uint256[3] memory workerKeys;
        uint256[3] memory agentIds;
        string[3] memory names;

        for (uint256 i = 0; i < 3; i++) {
            string memory idx = vm.toString(i);
            string memory base = string.concat(".agents[", idx, "]");

            names[i] = vm.parseJsonString(json, string.concat(base, ".name"));
            workerAddrs[i] = vm.parseJsonAddress(json, string.concat(base, ".address"));
            agentIds[i] = vm.parseJsonUint(json, string.concat(base, ".agentId"));

            string memory pkHex = vm.parseJsonString(json, string.concat(base, ".privateKey"));
            workerKeys[i] = vm.parseUint(pkHex);
        }

        console.log("=== Agents loaded from sepolia-agents.json ===");
        for (uint256 i = 0; i < 3; i++) {
            console.log("  %s: %s (agentId: %d)", names[i], workerAddrs[i], agentIds[i]);
        }

        // ── Deploy contracts (as deployer) ──────────────────────────────
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("\n=== Deploying ===");
        console.log("  Deployer: %s", deployer);
        console.log("  IdentityRegistry: %s", IDENTITY_REGISTRY);
        console.log("  ReputationRegistry: %s", REPUTATION_REGISTRY);

        vm.startBroadcast(deployerKey);

        // 1. Deploy CREsolverMarket
        CREsolverMarket market = new CREsolverMarket(IDENTITY_REGISTRY, REPUTATION_REGISTRY);
        console.log("\n  CREsolverMarket: %s", address(market));

        // 2. Authorize deployer as resolver (for direct resolution demo)
        market.setAuthorizedResolver(deployer, true);
        console.log("  Deployer authorized as resolver");

        // 3. Create a test market
        uint256 marketId = market.createMarket{value: 0.01 ether}(
            "Will bitcoin reach 200k by end of 2026?",
            7 days
        );
        console.log("\n  Market #%d created", marketId);
        console.log("    Question: Will bitcoin reach 200k by end of 2026?");
        console.log("    Reward: 0.01 ETH");
        console.log("    Duration: 7 days");

        vm.stopBroadcast();

        // ── Workers join market ─────────────────────────────────────────
        console.log("\n=== Workers joining market ===");

        for (uint256 i = 0; i < 3; i++) {
            vm.startBroadcast(workerKeys[i]);

            market.joinMarket{value: 0.005 ether}(marketId, agentIds[i]);
            console.log("  %s joined (agentId: %d, stake: 0.005 ETH)", names[i], agentIds[i]);

            vm.stopBroadcast();
        }

        // ── Summary ─────────────────────────────────────────────────────
        console.log("\n========================================");
        console.log("  Deployment complete!");
        console.log("========================================");
        console.log("  CREsolverMarket: %s", address(market));
        console.log("  Market ID: %d", marketId);
        console.log("  Workers: 3 (with ERC-8004 identity)");
        console.log("  Network: Sepolia");
        console.log("========================================\n");
    }
}

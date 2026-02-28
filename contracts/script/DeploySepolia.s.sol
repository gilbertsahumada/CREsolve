// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";
import {CREReceiver} from "../src/CREReceiver.sol";
import {BinaryMarket} from "../src/BinaryMarket.sol";

/**
 * @title DeploySepolia
 * @notice Deploys CREsolverMarket on Sepolia with ERC-8004 registries.
 *         If KEYSTONE_FORWARDER is provided, it also deploys CREReceiver
 *         and authorizes it as resolver.
 *         Does NOT create any markets — use SetupDemoMarkets.s.sol for that.
 *
 * Prerequisites:
 *   1. Run `yarn sepolia:wallets` to create worker wallets
 *   2. Run `yarn sepolia:sync` to register/normalize ERC-8004 agents
 *   3. Ensure workers are funded (sepolia:sync can top-up)
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_KEY=0x... forge script script/DeploySepolia.s.sol \
 *     --rpc-url $SEPOLIA_RPC --broadcast -vvvv
 */
contract DeploySepoliaScript is Script {
    function run() external {
        // Sepolia/Testnets addresses (overridable via env) 
        address IDENTITY_REGISTRY = vm.envOr("ERC8004_IDENTITY", 0x8004A818BFB912233c491871b3d84c89A494BD9e);
        address REPUTATION_REGISTRY = vm.envOr("ERC8004_REPUTATION", 0x8004B663056A597Dffe9eCcC1965A193B7388713);
        address KEYSTONE_FORWARDER = vm.envOr("KEYSTONE_FORWARDER", 0x15fC6ae953E024d975e77382eEeC56A9101f9F88);

        // ── Read sepolia-agents.json ─────────────────────────────────────
        string memory json = vm.readFile("../scripts/sepolia-agents.json");

        if(bytes(json).length == 0) {
            revert("sepolia-agents.json not found or empty. Please run `yarn sepolia:wallets` and `yarn sepolia:sync` first.");
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
        console.log("  KeystoneForwarder: %s", KEYSTONE_FORWARDER);

        vm.startBroadcast(deployerKey);

        // 1. Deploy CREsolverMarket
        CREsolverMarket market = new CREsolverMarket(IDENTITY_REGISTRY, REPUTATION_REGISTRY);
        console.log("\n  CREsolverMarket: %s", address(market));

        // 2. Optional CREReceiver deployment for CRE writeReport path
        address receiverAddress = address(0);
        if (KEYSTONE_FORWARDER != address(0)) {
            CREReceiver receiver = new CREReceiver(address(market), KEYSTONE_FORWARDER);
            receiverAddress = address(receiver);
            console.log("  CREReceiver: %s", receiverAddress);
            console.log("  Forwarder: %s", KEYSTONE_FORWARDER);

            market.setAuthorizedResolver(receiverAddress, true);
            console.log("  CREReceiver authorized as resolver");
        } else {
            console.log("  KEYSTONE_FORWARDER not set: skipping CREReceiver deploy");
        }

        // 3. Deploy BinaryMarket (companion betting contract)
        BinaryMarket binary = new BinaryMarket(address(market));
        console.log("  BinaryMarket: %s", address(binary));

        vm.stopBroadcast();

        // ── Summary ─────────────────────────────────────────────────────
        console.log("\n========================================");
        console.log("  Deployment complete!");
        console.log("========================================");
        console.log("  CREsolverMarket: %s", address(market));
        console.log("  CREReceiver: %s", receiverAddress);
        console.log("  BinaryMarket: %s", address(binary));
        console.log("  Network: Sepolia");
        console.log("  Markets: 0 (use SetupDemoMarkets.s.sol)");
        console.log("========================================\n");
    }
}

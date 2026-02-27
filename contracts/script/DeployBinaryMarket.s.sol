// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BinaryMarket} from "../src/BinaryMarket.sol";

/**
 * @title DeployBinaryMarket
 * @notice Deploys BinaryMarket companion contract pointing to an existing CREsolverMarket.
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_KEY=0x... CORE_MARKET=0x... forge script script/DeployBinaryMarket.s.sol \
 *     --rpc-url $SEPOLIA_RPC --broadcast -vvvv
 */
contract DeployBinaryMarketScript is Script {
    function run() external {
        address coreMarket = vm.envAddress("CORE_MARKET");
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");

        console.log("=== Deploying BinaryMarket ===");
        console.log("  Core Market: %s", coreMarket);

        vm.startBroadcast(deployerKey);

        BinaryMarket binary = new BinaryMarket(coreMarket);
        console.log("  BinaryMarket: %s", address(binary));

        vm.stopBroadcast();

        console.log("\n========================================");
        console.log("  BinaryMarket deployed!");
        console.log("  Address: %s", address(binary));
        console.log("  Core Market: %s", coreMarket);
        console.log("========================================\n");
    }
}

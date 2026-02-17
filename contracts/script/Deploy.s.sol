// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CREsolverMarket} from "../src/CREsolverMarket.sol";
import {CREReceiver} from "../src/CREReceiver.sol";

contract DeployScript is Script {
    function run() external {
        address keystoneForwarder = vm.envOr("KEYSTONE_FORWARDER", address(0));
        address directResolver = vm.envOr("DIRECT_RESOLVER", address(0));

        vm.startBroadcast();

        // 1. Deploy CREsolverMarket
        CREsolverMarket market = new CREsolverMarket();
        console.log("CREsolverMarket deployed at:", address(market));

        // 2. Deploy CREReceiver
        CREReceiver receiver = new CREReceiver(address(market), keystoneForwarder);
        console.log("CREReceiver deployed at:", address(receiver));

        // 3. Authorize CREReceiver as a resolver
        market.setAuthorizedResolver(address(receiver), true);
        console.log("CREReceiver authorized as resolver");

        // 4. Optionally authorize a direct signer for local demo
        if (directResolver != address(0)) {
            market.setAuthorizedResolver(directResolver, true);
            console.log("Direct resolver authorized:", directResolver);
        }

        vm.stopBroadcast();
    }
}

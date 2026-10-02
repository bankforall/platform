// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Script, console} from "forge-std/Script.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

import {CircleFactory} from "../src/CircleFactory.sol";

/// @notice Deploys the ERC-2771 forwarder and CircleFactory (which deploys the Circle implementation)
///         and writes the addresses to deployments/<chainId>.json for the API and web app.
///
///   ADMIN=0x... ATTESTER=0x... forge script script/Deploy.s.sol \
///     --rpc-url $RPC_URL --account deployer --broadcast --verify
contract Deploy is Script {
    function run() external returns (CircleFactory factory, ERC2771Forwarder forwarder) {
        address admin = vm.envAddress("ADMIN");
        address attester = vm.envAddress("ATTESTER");

        vm.startBroadcast();
        forwarder = new ERC2771Forwarder("BankForAllForwarder");
        factory = new CircleFactory(admin, attester, address(forwarder));
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "blockNumber", block.number);
        vm.serializeAddress(key, "forwarder", address(forwarder));
        vm.serializeAddress(key, "circleImplementation", factory.implementation());
        string memory out = vm.serializeAddress(key, "factory", address(factory));
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), ".json"));

        console.log("ERC2771Forwarder", address(forwarder));
        console.log("CircleFactory", address(factory));
    }
}

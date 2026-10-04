// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {Script, console} from "forge-std/Script.sol";

import {CircleFactory} from "../src/CircleFactory.sol";

/// @notice Step 1 of moving the factory admin from the deployer key to a Safe multisig, run by the
///         current admin. Grants the emergency pauser, optionally swaps the attester key, and starts
///         the delayed admin transfer. Step 2 is done by the Safe after the delay: a transaction to
///         the factory calling `acceptDefaultAdminTransfer()` (Safe → Transaction Builder).
///
///   FACTORY=0x... SAFE=0x... PAUSER=0x... [NEW_ATTESTER=0x... OLD_ATTESTER=0x...] \
///     forge script script/HandOverAdmin.s.sol --rpc-url $RPC_URL --account deployer --broadcast
contract HandOverAdmin is Script {
    function run() external {
        CircleFactory factory = CircleFactory(vm.envAddress("FACTORY"));
        address safe = vm.envAddress("SAFE");
        address pauser = vm.envAddress("PAUSER");
        address newAttester = vm.envOr("NEW_ATTESTER", address(0));
        address oldAttester = vm.envOr("OLD_ATTESTER", address(0));

        vm.startBroadcast();
        _apply(factory, safe, pauser, newAttester, oldAttester);
        vm.stopBroadcast();

        (, uint48 acceptAfter) = factory.pendingDefaultAdmin();
        console.log("Pending admin", safe);
        console.log("Safe may accept after (unix)", acceptAfter);
    }

    /// @dev Used by tests: runs the same steps as `admin` without broadcasting.
    function handOver(
        CircleFactory factory,
        address admin,
        address safe,
        address pauser,
        address newAttester,
        address oldAttester
    ) external {
        vm.startPrank(admin);
        _apply(factory, safe, pauser, newAttester, oldAttester);
        vm.stopPrank();
    }

    function _apply(
        CircleFactory factory,
        address safe,
        address pauser,
        address newAttester,
        address oldAttester
    ) internal {
        require(safe.code.length > 0 || block.chainid == 31337, "SAFE is not a contract");
        require(pauser != address(0) && pauser != safe, "PAUSER must be a separate ops key");
        factory.grantRole(factory.PAUSER_ROLE(), pauser);
        if (newAttester != address(0)) {
            factory.grantRole(factory.ATTESTER_ROLE(), newAttester);
            if (oldAttester != address(0)) factory.revokeRole(factory.ATTESTER_ROLE(), oldAttester);
        }
        factory.beginDefaultAdminTransfer(safe);
    }
}

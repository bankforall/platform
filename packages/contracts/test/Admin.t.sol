// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {BaseTest} from "./Base.t.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {HandOverAdmin} from "../script/HandOverAdmin.s.sol";

/// @notice Admin handover to a Safe and the emergency pauser (docs/v2/deployment.md §multisig).
contract AdminTest is BaseTest {
    address safe = makeAddr("safe");
    address pauser = makeAddr("pauser");

    function test_adminCannotBeGrantedDirectly() public {
        bytes32 adminRole = factory.DEFAULT_ADMIN_ROLE();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("AccessControlEnforcedDefaultAdminRules()"));
        factory.grantRole(adminRole, safe);
    }

    function test_handoverTakesTwoStepsAndTheDelay() public {
        vm.prank(admin);
        factory.beginDefaultAdminTransfer(safe);

        vm.prank(safe);
        vm.expectRevert(); // too early
        factory.acceptDefaultAdminTransfer();

        vm.warp(block.timestamp + factory.INITIAL_ADMIN_DELAY() + 1);
        vm.prank(safe);
        factory.acceptDefaultAdminTransfer();
        assertEq(factory.defaultAdmin(), safe);
        assertFalse(factory.hasRole(factory.DEFAULT_ADMIN_ROLE(), admin));

        vm.prank(admin);
        vm.expectRevert();
        factory.setPolicy(1_500, 110, 30 days);
        vm.prank(safe);
        factory.setPolicy(1_500, 110, 30 days);
    }

    function test_aMistakenHandoverCanBeCancelled() public {
        vm.prank(admin);
        factory.beginDefaultAdminTransfer(makeAddr("typo"));
        vm.prank(admin);
        factory.cancelDefaultAdminTransfer();
        vm.warp(block.timestamp + 3 days);
        vm.prank(makeAddr("typo"));
        vm.expectRevert();
        factory.acceptDefaultAdminTransfer();
        assertEq(factory.defaultAdmin(), admin);
    }

    function test_pauserCanOnlyPause() public {
        bytes32 pauserRole = factory.PAUSER_ROLE();
        vm.prank(admin);
        factory.grantRole(pauserRole, pauser);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(CircleFactory.NotPauser.selector);
        factory.pause();

        vm.prank(pauser);
        factory.pause();
        assertTrue(factory.paused());

        vm.prank(pauser);
        vm.expectRevert();
        factory.unpause();
        vm.prank(pauser);
        vm.expectRevert();
        factory.setPolicy(100_00, 0, 1);

        vm.prank(admin);
        factory.unpause();
        assertFalse(factory.paused());
    }

    function test_handoverScriptStartsTheTransferAndSetsUpRoles() public {
        HandOverAdmin script = new HandOverAdmin();
        address newAttester = makeAddr("attester2");
        script.handOver(factory, admin, safe, pauser, newAttester, attester);
        assertTrue(factory.hasRole(factory.PAUSER_ROLE(), pauser));
        assertTrue(factory.hasRole(factory.ATTESTER_ROLE(), newAttester));
        assertFalse(factory.hasRole(factory.ATTESTER_ROLE(), attester));
        (address pending,) = factory.pendingDefaultAdmin();
        assertEq(pending, safe);
    }
}

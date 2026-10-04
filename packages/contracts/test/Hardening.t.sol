// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

import {BaseTest} from "./Base.t.sol";
import {Circle} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Attestation, CircleParams, CircleType} from "../src/CircleTypes.sol";

/// @notice Regression tests for the pre-launch security review (H1, H2 and hardening).
contract RecipientGriefingTest is BaseTest {
    Circle c;
    address[] m;
    address recipient;
    // defaultParams: paymentWindow 3d, grace 1d → default after 4d, accept after 5d

    function setUp() public override {
        super.setUp();
        (c, m) = startedCircle(defaultParams(CircleType.Float, 3));
        recipient = recipientOf(c, 1);
    }

    function test_declaredPaymentCannotBeDefaulted() public {
        vm.prank(m[1]);
        c.declarePayment(keccak256("slip"));
        vm.warp(block.timestamp + 4 * DAY + 1);
        vm.expectRevert(Circle.BadPaymentStatus.selector);
        c.markDefault(m[1]);
    }

    function test_silentRecipient_paymentIsAcceptedAfterTheRejectWindow() public {
        vm.prank(m[1]);
        c.declarePayment(keccak256("slip"));
        vm.warp(block.timestamp + 5 * DAY);
        vm.expectRevert(Circle.TooEarly.selector);
        c.acceptDeclared(m[1]);
        vm.warp(block.timestamp + 1);
        c.acceptDeclared(m[1]); // anyone (the keeper) can finalise
        assertEq(uint8(payStatus(c, 1, m[1])), uint8(Circle.PayStatus.Confirmed));
        (,,,,,, uint8 settled,,) = c.rounds(1);
        assertEq(settled, 1);
    }

    function test_recipientRejects_thenUnpaidPayerCanBeDefaulted() public {
        vm.prank(m[1]);
        c.declarePayment(keccak256("fake-slip"));
        vm.prank(m[2]);
        vm.expectRevert(Circle.NotRecipient.selector);
        c.rejectPayment(m[1]);
        vm.prank(recipient);
        c.rejectPayment(m[1]);
        assertEq(uint8(payStatus(c, 1, m[1])), uint8(Circle.PayStatus.None));
        vm.prank(m[1]);
        c.declarePayment(keccak256("real-slip")); // may declare again before the default time
        vm.prank(recipient);
        c.rejectPayment(m[1]);
        vm.warp(block.timestamp + 4 * DAY + 1);
        vm.prank(m[1]);
        vm.expectRevert(Circle.OutsideWindow.selector);
        c.declarePayment(keccak256("too-late"));
        c.markDefault(m[1]);
        assertEq(uint8(payStatus(c, 1, m[1])), uint8(Circle.PayStatus.Defaulted));
    }

    function test_rejectWindowCloses() public {
        vm.prank(m[1]);
        c.declarePayment(keccak256("slip"));
        vm.warp(block.timestamp + 5 * DAY + 1);
        vm.prank(recipient);
        vm.expectRevert(Circle.OutsideWindow.selector);
        c.rejectPayment(m[1]);
    }

    function test_attestedSlipSettlesAndCannotBeRejectedOrDefaulted() public {
        bytes32 slip = keccak256("slip");
        vm.prank(m[1]);
        c.declarePayment(slip);
        vm.prank(attester);
        c.attestSlip(m[1], slip);
        (,,,,,, uint8 settled,,) = c.rounds(1);
        assertEq(settled, 1);
        vm.prank(recipient);
        vm.expectRevert(Circle.BadPaymentStatus.selector);
        c.rejectPayment(m[1]);
        vm.warp(block.timestamp + 6 * DAY);
        vm.expectRevert(Circle.BadPaymentStatus.selector);
        c.markDefault(m[1]);
        // a later confirmation does not double count
        vm.prank(recipient);
        c.confirmReceipt(m[1]);
        (,,,,,, settled,,) = c.rounds(1);
        assertEq(settled, 1);
    }
}

contract RotationDuringBiddingTest is BaseTest {
    Circle c;
    address[] m;
    address fresh = makeAddr("fresh");

    function setUp() public override {
        super.setUp();
        (c, m) = startedCircle(defaultParams(CircleType.Float, 4));
        settleAll(c, m);
        vm.warp(block.timestamp + 30 * DAY);
        c.nextRound(); // round 2 has bidding
    }

    function _rotate(address oldMember, address newMember) internal {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(attesterKey, factory.keyRotationDigest(address(c), oldMember, newMember, deadline));
        c.rotateMember(oldMember, newMember, deadline, abi.encodePacked(r, s, v));
    }

    /// H1: the old key's sealed bid must not survive the rotation and win for a deleted address.
    function test_oldCommitIsDiscardedAndCannotWin() public {
        commitBidAs(c, m[1], 9_000); // highest bid, then the phone is lost
        commitBidAs(c, m[2], 100);
        _rotate(m[1], fresh);
        (bytes32 hash,,) = c.commits(2, m[1]);
        assertEq(hash, bytes32(0));

        commitBidAs(c, fresh, 500); // the person may bid again with the new key
        vm.warp(block.timestamp + DAY);
        vm.expectRevert(Circle.NotMember.selector);
        c.revealBid(m[1], 9_000, keccak256(abi.encode(m[1], uint128(9_000))));
        reveal(c, m[2], 100);
        reveal(c, fresh, 500);
        vm.warp(block.timestamp + DAY);
        c.closeBidding();
        assertEq(recipientOf(c, 2), fresh);
    }

    function test_revealedBestBidFollowsTheRotatedKey() public {
        commitBidAs(c, m[1], 9_000);
        vm.warp(block.timestamp + DAY);
        reveal(c, m[1], 9_000);
        _rotate(m[1], fresh);
        vm.warp(block.timestamp + DAY);
        c.closeBidding();
        assertEq(recipientOf(c, 2), fresh);
    }
}

contract FactoryHardeningTest is BaseTest {
    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(CircleFactory.InvalidParams.selector);
        new CircleFactory(address(0), attester, address(forwarder));
        vm.expectRevert(CircleFactory.InvalidParams.selector);
        new CircleFactory(admin, address(0), address(forwarder));
        vm.expectRevert(CircleFactory.InvalidParams.selector);
        new CircleFactory(admin, attester, address(0));
    }

    function test_graceIsRequiredAndCountedTwiceInThePeriod() public {
        address host = makeAddr("host");
        (Attestation memory att, bytes memory sig) = attest(host, address(0), 0);
        CircleParams memory p = defaultParams(CircleType.Float, 3);
        p.grace = 0;
        vm.prank(host);
        vm.expectRevert(CircleFactory.InvalidParams.selector);
        factory.createCircle(p, 0, att, sig);

        p = defaultParams(CircleType.Float, 3);
        p.period = 6 * DAY; // 1 + 1 + 3 + 2×1 = 7 days needed
        vm.prank(host);
        vm.expectRevert(CircleFactory.InvalidParams.selector);
        factory.createCircle(p, 0, att, sig);
    }
}

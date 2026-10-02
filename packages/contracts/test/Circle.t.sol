// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {BaseTest} from "./Base.t.sol";
import {Circle} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Attestation, CircleParams, CircleType} from "../src/CircleTypes.sol";

contract FactoryTest is BaseTest {
    address host = makeAddr("host");

    function test_createCircle_registersHostAndSlot() public {
        Circle c = create(host, defaultParams(CircleType.Float, 5), 0, 42);
        assertTrue(factory.isCircle(address(c)));
        assertEq(factory.activeCircles(host), 1);
        assertEq(c.host(), host);
        assertEq(c.members().length, 1);
        (,,,,, uint32 rep,) = c.memberInfo(host);
        assertEq(rep, 42);
    }

    function test_createCircle_rejectsForeignSigner() public {
        (, uint256 otherKey) = makeAddrAndKey("not-attester");
        Attestation memory att = Attestation(host, address(0), 0, uint64(block.timestamp + 1));
        bytes memory sig = signAttestation(att, otherKey);
        vm.prank(host);
        vm.expectRevert(CircleFactory.InvalidAttestation.selector);
        factory.createCircle(defaultParams(CircleType.Float, 5), 0, att, sig);
    }

    function test_createCircle_rejectsExpiredOrBorrowedAttestation() public {
        (Attestation memory att, bytes memory sig) = attest(host, address(0), 0);
        vm.warp(att.deadline + 1);
        vm.prank(host);
        vm.expectRevert(CircleFactory.InvalidAttestation.selector);
        factory.createCircle(defaultParams(CircleType.Float, 5), 0, att, sig);

        (att, sig) = attest(host, address(0), 0);
        vm.prank(makeAddr("someone-else"));
        vm.expectRevert(CircleFactory.InvalidAttestation.selector);
        factory.createCircle(defaultParams(CircleType.Float, 5), 0, att, sig);
    }

    function test_legalCaps() public {
        CircleParams memory p = defaultParams(CircleType.Float, 31);
        (Attestation memory att, bytes memory sig) = attest(host, address(0), 0);
        vm.startPrank(host);
        vm.expectRevert(CircleFactory.OverLegalCap.selector);
        factory.createCircle(p, 0, att, sig);

        p = defaultParams(CircleType.Float, 30);
        p.principal = 1_000_001; // 30 × 10,000.01 baht > 300,000 baht
        vm.expectRevert(CircleFactory.OverLegalCap.selector);
        factory.createCircle(p, 0, att, sig);

        p.principal = 1_000_000; // exactly 300,000 baht
        for (uint256 i = 0; i < 3; i++) {
            factory.createCircle(p, 0, att, sig);
        }
        vm.expectRevert(CircleFactory.OverLegalCap.selector);
        factory.createCircle(p, 0, att, sig);
        vm.stopPrank();
    }

    function test_cancelFreesHostingSlot() public {
        Circle c = create(host, defaultParams(CircleType.Float, 5), 0, 0);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(Circle.NotHost.selector);
        c.cancel();
        vm.prank(host);
        c.cancel();
        assertEq(factory.activeCircles(host), 0);
        assertEq(uint8(c.status()), uint8(Circle.Status.Cancelled));
    }

    function test_invalidParams() public {
        CircleParams memory p = defaultParams(CircleType.Float, 5);
        p.fixRateBps = 100; // only valid for Fix
        (Attestation memory att, bytes memory sig) = attest(host, address(0), 0);
        vm.startPrank(host);
        vm.expectRevert(CircleFactory.InvalidParams.selector);
        factory.createCircle(p, 0, att, sig);

        p = defaultParams(CircleType.Float, 5);
        p.period = 5 * DAY; // shorter than bid + reveal + payment + grace
        vm.expectRevert(CircleFactory.InvalidParams.selector);
        factory.createCircle(p, 0, att, sig);

        p = defaultParams(CircleType.Fix, 5);
        vm.expectRevert(CircleFactory.InvalidParams.selector);
        factory.createCircle(p, 5, att, sig); // seat out of range
        vm.stopPrank();
    }

    function test_onlyCirclesCanFreeSlots() public {
        vm.expectRevert(CircleFactory.NotCircle.selector);
        factory.onCircleClosed(host);
    }

    function test_rejectsEther() public {
        Circle c = create(host, defaultParams(CircleType.Float, 5), 0, 0);
        vm.deal(address(this), 1 ether);
        (bool okCircle,) = address(c).call{value: 1}("");
        (bool okFactory,) = address(factory).call{value: 1}("");
        assertFalse(okCircle);
        assertFalse(okFactory);
    }

    function test_implementationCannotBeInitialized() public {
        Circle impl = Circle(factory.implementation());
        vm.expectRevert();
        impl.initialize(defaultParams(CircleType.Float, 5), host, 0, 0);
    }
}

contract MembershipTest is BaseTest {
    address host = makeAddr("host");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    Circle c;

    function setUp() public override {
        super.setUp();
        CircleParams memory p = defaultParams(CircleType.Fix, 3);
        p.minReputation = 10;
        c = create(host, p, 1, 50);
    }

    function test_attestationIsBoundToCircleAndSubject() public {
        (Attestation memory att, bytes memory sig) = attest(alice, address(0), 50);
        vm.prank(alice);
        vm.expectRevert(Circle.NotEligible.selector);
        c.join(0, att, sig);

        (att, sig) = attest(alice, address(c), 50);
        vm.prank(bob);
        vm.expectRevert(Circle.NotEligible.selector);
        c.join(0, att, sig);
    }

    function test_reputationSeatsAndCapacity() public {
        (Attestation memory att, bytes memory sig) = attest(alice, address(c), 9);
        vm.prank(alice);
        vm.expectRevert(Circle.ReputationTooLow.selector);
        c.join(0, att, sig);

        (att, sig) = attest(alice, address(c), 10);
        vm.prank(alice);
        vm.expectRevert(Circle.SeatTaken.selector);
        c.join(1, att, sig); // host's seat

        joinAs(c, alice, 0, 10);
        assertEq(c.seatOwner(0), alice);

        (att, sig) = attest(alice, address(c), 10);
        vm.prank(alice);
        vm.expectRevert(Circle.AlreadyMember.selector);
        c.join(2, att, sig);

        vm.prank(host);
        vm.expectRevert(Circle.NotReady.selector);
        c.start();

        joinAs(c, bob, 2, 10);
        (att, sig) = attest(makeAddr("carol"), address(c), 10);
        vm.prank(makeAddr("carol"));
        vm.expectRevert(Circle.CircleFull.selector);
        c.join(0, att, sig);

        vm.prank(alice);
        vm.expectRevert(Circle.NotHost.selector);
        c.start();
        vm.prank(host);
        c.start();
        assertEq(recipientOf(c, 1), alice, "seat 0 receives round 1");
    }
}

contract BiddingTest is BaseTest {
    Circle c;
    address[] m;

    function setUp() public override {
        super.setUp();
        (c, m) = startedCircle(defaultParams(CircleType.Float, 4));
        // round 1 belongs to the host; settle it and move to the first bidding round
        settleAll(c, m);
        vm.warp(block.timestamp + 30 * DAY);
        c.nextRound();
        assertTrue(c.needsBidding(2));
    }

    function test_pastWinnerCannotBid() public {
        vm.prank(m[0]);
        vm.expectRevert(Circle.NotEligible.selector);
        c.commitBid(bytes32(uint256(1)));
    }

    function test_windowsAreEnforced() public {
        commitBidAs(c, m[1], 500);
        vm.expectRevert(Circle.OutsideWindow.selector);
        reveal(c, m[1], 500); // still in commit phase

        vm.warp(block.timestamp + DAY);
        vm.prank(m[2]);
        vm.expectRevert(Circle.OutsideWindow.selector);
        c.commitBid(bytes32(uint256(1)));

        vm.expectRevert(Circle.OutsideWindow.selector);
        c.closeBidding(); // reveal phase not over

        vm.prank(m[1]);
        vm.expectRevert(Circle.BadReveal.selector);
        c.revealBid(m[1], 501, keccak256(abi.encode(m[1], uint128(500))));

        reveal(c, m[1], 500);
        vm.prank(m[1]);
        vm.expectRevert(Circle.BadReveal.selector);
        c.revealBid(m[1], 500, keccak256(abi.encode(m[1], uint128(500))));
    }

    function test_cannotCommitTwice() public {
        commitBidAs(c, m[1], 1);
        vm.prank(m[1]);
        vm.expectRevert(Circle.AlreadyCommitted.selector);
        c.commitBid(bytes32(uint256(2)));
    }

    function test_bidAbovePrincipalIsRejectedAtReveal() public {
        commitBidAs(c, m[1], 100_001);
        vm.warp(block.timestamp + DAY);
        vm.prank(m[1]);
        vm.expectRevert(Circle.BidTooHigh.selector);
        c.revealBid(m[1], 100_001, keccak256(abi.encode(m[1], uint128(100_001))));
    }

    function test_unrevealedBidsDoNotCount() public {
        commitBidAs(c, m[3], 9_000); // never revealed
        commitBidAs(c, m[2], 100);
        vm.warp(block.timestamp + DAY);
        reveal(c, m[2], 100);
        vm.warp(block.timestamp + DAY);
        c.closeBidding();
        assertEq(recipientOf(c, 2), m[2]);

        vm.expectRevert(Circle.AlreadyDecided.selector);
        c.closeBidding();
    }

    function test_noBidsFallsBackToJoinOrder() public {
        vm.warp(block.timestamp + 2 * DAY);
        c.closeBidding();
        assertEq(recipientOf(c, 2), m[1]);
        (,,,,,,,, uint128 winningBid) = c.rounds(2);
        assertEq(winningBid, 0);
    }
}

contract PaymentsTest is BaseTest {
    Circle c;
    address[] m;
    address recipient;

    function setUp() public override {
        super.setUp();
        (c, m) = startedCircle(defaultParams(CircleType.Float, 3));
        recipient = recipientOf(c, 1);
        assertEq(recipient, m[0]);
    }

    function test_declareAttestConfirm() public {
        bytes32 slip = keccak256("slip-1");
        vm.prank(m[1]);
        c.declarePayment(slip);
        assertEq(uint8(payStatus(c, 1, m[1])), uint8(Circle.PayStatus.Declared));

        vm.prank(m[2]);
        vm.expectRevert(Circle.NotAttester.selector);
        c.attestSlip(m[1], slip);

        vm.startPrank(attester);
        vm.expectRevert(Circle.SlipMismatch.selector);
        c.attestSlip(m[1], keccak256("forged"));
        c.attestSlip(m[1], slip);
        vm.stopPrank();
        assertEq(uint8(payStatus(c, 1, m[1])), uint8(Circle.PayStatus.Attested));

        vm.prank(m[2]);
        vm.expectRevert(Circle.NotRecipient.selector);
        c.confirmReceipt(m[1]);

        vm.prank(recipient);
        c.confirmReceipt(m[1]);
        assertEq(uint8(payStatus(c, 1, m[1])), uint8(Circle.PayStatus.Confirmed));

        vm.prank(recipient);
        vm.expectRevert(Circle.BadPaymentStatus.selector);
        c.confirmReceipt(m[1]);
    }

    function test_recipientDoesNotPayThemselves() public {
        vm.prank(recipient);
        vm.expectRevert(Circle.IsRecipient.selector);
        c.declarePayment(bytes32(0));
        assertEq(c.amountDue(recipient), 0);
    }

    function test_nextRoundNeedsSettlementAndPeriod() public {
        vm.expectRevert(Circle.NotReady.selector);
        c.nextRound();
        settleAll(c, m);
        vm.expectRevert(Circle.TooEarly.selector);
        c.nextRound();
        vm.warp(block.timestamp + 30 * DAY);
        c.nextRound();
        assertEq(c.currentRound(), 2);
    }

    function test_defaultAfterGrace_thenLatePayment() public {
        vm.prank(recipient);
        c.confirmReceipt(m[2]);

        // payment window (3 days) + grace (1 day)
        vm.warp(block.timestamp + 4 * DAY);
        vm.expectRevert(Circle.TooEarly.selector);
        c.markDefault(m[1]);

        vm.warp(block.timestamp + 1);
        vm.expectRevert(Circle.BadPaymentStatus.selector);
        c.markDefault(m[2]); // already paid
        c.markDefault(m[1]);
        (,, bool defaulted,,,,) = c.memberInfo(m[1]);
        assertTrue(defaulted);
        (, uint128 amount,) = c.payments(1, m[1]);
        assertEq(amount, 100_000);

        // the round is settled (paid or in default) so the circle can move on
        vm.warp(block.timestamp + 30 * DAY);
        // a late payment is still recorded without double-counting the settlement
        vm.prank(recipient);
        c.confirmReceipt(m[1]);
        assertEq(uint8(payStatus(c, 1, m[1])), uint8(Circle.PayStatus.Confirmed));
        (,,,,,, uint8 settled,,) = c.rounds(1);
        assertEq(settled, 2);
        c.nextRound();

        // the defaulter can no longer bid
        vm.prank(m[1]);
        vm.expectRevert(Circle.NotEligible.selector);
        c.commitBid(bytes32(uint256(1)));
    }

    function test_disputeOnlyByMembers() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(Circle.NotMember.selector);
        c.dispute(1, keccak256("reason"));

        vm.expectEmit(address(c));
        emit Circle.Disputed(1, m[1], keccak256("reason"));
        vm.prank(m[1]);
        c.dispute(1, keccak256("reason"));
    }

    function test_pauseBlocksActions() public {
        vm.prank(admin);
        factory.pause();
        vm.prank(m[1]);
        vm.expectRevert(Circle.Paused.selector);
        c.declarePayment(bytes32(0));

        vm.prank(admin);
        factory.unpause();
        vm.prank(m[1]);
        c.declarePayment(bytes32(0));
    }
}

contract FixDefaultTest is BaseTest {
    /// A Fix member who defaults loses their turn: later seats move up and the defaulter
    /// receives only when nobody eligible is left.
    function test_defaulterIsSkippedInSeatOrder() public {
        CircleParams memory p = defaultParams(CircleType.Fix, 3);
        p.fixRateBps = 1000;
        (Circle c, address[] memory m) = startedCircle(p);
        assertEq(recipientOf(c, 1), m[0]);
        assertEq(c.amountDue(m[1]), 100_000); // middle seat pays principal
        assertEq(c.amountDue(m[2]), 90_000); // last seat pays -10%

        vm.prank(m[0]);
        c.confirmReceipt(m[2]);
        vm.warp(block.timestamp + 4 * DAY + 1);
        c.markDefault(m[1]);

        vm.warp(block.timestamp + 30 * DAY);
        c.nextRound();
        assertEq(recipientOf(c, 2), m[2], "seat 2 moves ahead of the defaulter");

        settleAll(c, m);
        vm.warp(block.timestamp + 30 * DAY);
        c.nextRound();
        assertEq(recipientOf(c, 3), m[1], "defaulter receives last");
    }
}

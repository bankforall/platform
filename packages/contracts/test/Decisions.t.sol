// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {BaseTest} from "./Base.t.sol";
import {Circle} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Attestation, CircleParams, CircleType} from "../src/CircleTypes.sol";

/// @notice docs/v2/decisions.md, with the factory's real default policy (15%/year, trusted ≥ 110).
abstract contract DefaultPolicyTest is BaseTest {
    function setUp() public virtual override {
        super.setUp();
        vm.prank(admin);
        factory.setPolicy(1_500, 110, 30 days);
    }
}

/// D3 — annualised interest cap.
contract InterestCapTest is DefaultPolicyTest {
    function test_bidCapIsAnnualised() public {
        // 1,000 baht, monthly: 100000 × 1500 × 30d / (365d × 10000) = 1232 satang
        assertEq(factory.bidCap(100_000, 30 days), 1232);
        (Circle c, address[] memory m) = startedCircle(defaultParams(CircleType.Float, 3));
        assertEq(c.maxBid(), 1232);
        settleAll(c, m);
        vm.warp(block.timestamp + 30 * DAY);
        c.nextRound();
        commitBidAs(c, m[1], 1233);
        commitBidAs(c, m[2], 1232);
        vm.warp(block.timestamp + DAY);
        vm.expectRevert(Circle.BidTooHigh.selector);
        c.revealBid(m[1], 1233, keccak256(abi.encode(m[1], uint128(1233))));
        reveal(c, m[2], 1232);
    }

    function test_biddingCircleNeedsRoomForABid() public {
        CircleParams memory p = defaultParams(CircleType.Float, 3);
        p.principal = 50; // 0.50 baht monthly → cap rounds down to 0
        (Attestation memory att, bytes memory sig) = attest(makeAddr("host"), address(0), TRUSTED);
        vm.prank(makeAddr("host"));
        vm.expectRevert(CircleFactory.InvalidParams.selector);
        factory.createCircle(p, 0, att, sig);
    }

    function test_fixLadderIsInterestToo() public {
        address host = makeAddr("host");
        (Attestation memory att, bytes memory sig) = attest(host, address(0), TRUSTED);
        CircleParams memory p = defaultParams(CircleType.Fix, 5);
        p.fixRateBps = 1000; // ±10% per month ≫ 15%/year
        vm.prank(host);
        vm.expectRevert(CircleFactory.OverLegalCap.selector);
        factory.createCircle(p, 0, att, sig);
        p.fixRateBps = 123; // 123 × 365 ≤ 1500 × 30
        vm.prank(host);
        factory.createCircle(p, 0, att, sig);
    }
}

/// D2 — newcomers cannot receive early; hosts need trust for the first round.
contract TrustTest is DefaultPolicyTest {
    function test_hostFirstRoundNeedsATrustedHost() public {
        address host = makeAddr("host");
        (Attestation memory att, bytes memory sig) = attest(host, address(0), 109);
        vm.prank(host);
        vm.expectRevert(Circle.NotTrusted.selector);
        factory.createCircle(defaultParams(CircleType.Float, 3), 0, att, sig);

        CircleParams memory p = defaultParams(CircleType.Float, 3);
        p.hostTakesFirst = false; // a newcomer may still host without taking the first round
        vm.prank(host);
        factory.createCircle(p, 0, att, sig);
    }

    function test_fixFirstHalfSeatsAreForTrustedMembers() public {
        Circle c = create(makeAddr("host"), defaultParams(CircleType.Fix, 4), 3, 100); // seat 3: second half
        address newcomer = makeAddr("newcomer");
        (Attestation memory att, bytes memory sig) = attest(newcomer, address(c), 100);
        vm.prank(newcomer);
        vm.expectRevert(Circle.NotTrusted.selector);
        c.join(1, att, sig); // seats 0 and 1 receive in the first half
        vm.prank(newcomer);
        c.join(2, att, sig);
        joinAs(c, makeAddr("trusted"), 0, TRUSTED);
    }
}

/// D1 — set-off; D5 relies on the recorded debts.
contract SetOffTest is DefaultPolicyTest {
    Circle c;
    address[] m;

    function setUp() public override {
        super.setUp();
        (c, m) = startedCircle(defaultParams(CircleType.Float, 3));
    }

    function _defaultAfter() internal {
        vm.warp(block.timestamp + 4 * DAY + 1); // paymentWindow 3d + grace 1d
    }

    function test_defaulterReceivesLessByWhatTheyOwe() public {
        // round 1 (host m0 receives): m1 pays, m2 defaults
        vm.prank(m[0]);
        c.confirmReceipt(m[1]);
        _defaultAfter();
        c.markDefault(m[2]);
        assertEq(c.owed(m[2], m[0]), 100_000);

        // round 2: m2 is in default, so m1 receives (fallback, no bids)
        vm.warp(block.timestamp + 30 * DAY);
        c.nextRound();
        vm.warp(block.timestamp + 2 * DAY);
        c.closeBidding();
        assertEq(recipientOf(c, 2), m[1]);
        vm.prank(m[2]);
        c.declarePayment(keccak256("slip"));
        vm.prank(m[1]);
        c.confirmReceipt(m[2]);
        vm.prank(m[1]);
        c.confirmReceipt(m[0]);

        // round 3: m2 receives; m0's whole contribution is set off against m2's debt
        vm.warp(block.timestamp + 30 * DAY);
        vm.expectEmit(address(c));
        emit Circle.PaymentOffset(3, m[0], m[2], 100_000, 0);
        c.nextRound();
        assertEq(recipientOf(c, 3), m[2]);
        assertEq(c.owed(m[2], m[0]), 0);
        assertEq(c.amountDue(m[0]), 0);
        assertEq(uint8(payStatus(c, 3, m[0])), uint8(Circle.PayStatus.Confirmed), "nothing to transfer");
        assertEq(c.amountDue(m[1]), 100_000, "m1 was paid by m2 and still owes in full");
        (,,,,,, uint8 settled,,) = c.rounds(3);
        assertEq(settled, 1);
    }

    function test_partialSetOffLeavesTheRestOwed() public {
        // round 1: m2 defaults on 100,000 to the host
        vm.prank(m[0]);
        c.confirmReceipt(m[1]);
        _defaultAfter();
        c.markDefault(m[2]);
        // round 2: m2 still in default and m1 receives; m2 defaults again (owes m1)
        vm.warp(block.timestamp + 30 * DAY);
        c.nextRound();
        vm.warp(block.timestamp + 2 * DAY);
        c.closeBidding();
        vm.prank(m[1]);
        c.confirmReceipt(m[0]);
        _defaultAfter();
        c.markDefault(m[2]);
        assertEq(c.owed(m[2], m[1]), 100_000);
        // round 3: each creditor sets off against what they owe m2
        vm.warp(block.timestamp + 30 * DAY);
        c.nextRound();
        assertEq(c.amountDue(m[0]), 0);
        assertEq(c.amountDue(m[1]), 0);
        (,,,,,, uint8 settled,,) = c.rounds(3);
        assertEq(settled, 2, "fully set off: the round settles without any transfer");
    }

    function test_latePaymentCuresTheDebt() public {
        vm.prank(m[0]);
        c.confirmReceipt(m[1]);
        _defaultAfter();
        c.markDefault(m[2]);
        vm.prank(m[0]);
        c.confirmReceipt(m[2]); // paid late in cash
        assertEq(c.owed(m[2], m[0]), 0);
        (,, bool defaulted,,,,) = c.memberInfo(m[2]);
        assertTrue(defaulted, "the default stays on record in this circle");
    }

    function test_rotationMovesDebts() public {
        vm.prank(m[0]);
        c.confirmReceipt(m[1]);
        _defaultAfter();
        c.markDefault(m[2]);
        address fresh = makeAddr("fresh");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(attesterKey, factory.keyRotationDigest(address(c), m[2], fresh, deadline));
        c.rotateMember(m[2], fresh, deadline, abi.encodePacked(r, s, v));
        assertEq(c.owed(m[2], m[0]), 0);
        assertEq(c.owed(fresh, m[0]), 100_000);
    }
}

/// D4 — abandoned open circles; D6 — pauses never cause defaults.
contract LifecycleTest is DefaultPolicyTest {
    function test_anyoneCancelsAStaleOpenCircle() public {
        address host = makeAddr("host");
        Circle c = create(host, defaultParams(CircleType.Float, 3), 0, TRUSTED);
        assertEq(c.openUntil(), block.timestamp + 30 days);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(Circle.NotHost.selector);
        c.cancel();
        vm.warp(c.openUntil() + 1);
        vm.prank(makeAddr("stranger"));
        c.cancel();
        assertEq(factory.activeCircles(host), 0);
    }

    function test_unpauseExtendsPaymentDeadlines() public {
        (Circle c, address[] memory m) = startedCircle(defaultParams(CircleType.Float, 3));
        vm.prank(admin);
        factory.pause();
        vm.warp(block.timestamp + 10 * DAY); // the whole payment window passes while paused
        vm.prank(admin);
        factory.unpause();
        vm.expectRevert(Circle.TooEarly.selector);
        c.markDefault(m[1]);
        vm.prank(m[1]);
        c.declarePayment(keccak256("slip")); // still allowed: grace counts from the unpause
        vm.warp(block.timestamp + DAY + 1);
        c.markDefault(m[2]);
    }
}

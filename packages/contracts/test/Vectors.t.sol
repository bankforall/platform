// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {BaseTest} from "./Base.t.sol";
import {Circle} from "../src/Circle.sol";
import {CircleParams, CircleType} from "../src/CircleTypes.sol";

/// @notice Replays packages/shared/test-vectors/circle-math.json through the real contract, so the
///         on-chain rules and the TypeScript `simulateCircle` can never drift apart.
contract VectorsTest is BaseTest {
    string internal json;

    function setUp() public override {
        super.setUp();
        json = vm.readFile("../shared/test-vectors/circle-math.json");
    }

    function test_allVectors() public {
        uint256 count;
        while (vm.keyExistsJson(json, string.concat(".vectors[", vm.toString(count), "]"))) count++;
        assertGt(count, 0, "no vectors found");
        for (uint256 i = 0; i < count; i++) {
            _run(string.concat(".vectors[", vm.toString(i), "]"));
        }
    }

    function _run(string memory v) internal {
        CircleParams memory p = defaultParams(
            CircleType(uint8(vm.parseJsonUint(json, string.concat(v, ".type")))),
            uint8(vm.parseJsonUint(json, string.concat(v, ".maxMembers")))
        );
        p.hostTakesFirst = vm.parseJsonBool(json, string.concat(v, ".hostTakesFirst"));
        p.fixRateBps = uint16(vm.parseJsonUint(json, string.concat(v, ".fixRateBps")));
        p.principal = uint128(vm.parseJsonUint(json, string.concat(v, ".principal")));
        uint256[] memory seats = vm.parseJsonUintArray(json, string.concat(v, ".seats"));
        uint256[] memory reps = vm.parseJsonUintArray(json, string.concat(v, ".reputations"));

        address[] memory m = new address[](p.maxMembers);
        for (uint256 i = 0; i < m.length; i++) {
            m[i] = makeAddr(string.concat(v, ".member", vm.toString(i)));
        }
        Circle c = create(m[0], p, uint8(seats[0]), uint32(reps[0]));
        for (uint256 i = 1; i < m.length; i++) {
            joinAs(c, m[i], uint8(seats[i]), uint32(reps[i]));
        }
        vm.prank(m[0]);
        c.start();

        for (uint8 r = 1; r <= p.maxMembers; r++) {
            string memory rk = string.concat(v, ".rounds[", vm.toString(r - 1), "]");
            _bid(c, m, r, rk);

            address recipient = recipientOf(c, r);
            assertEq(recipient, m[vm.parseJsonUint(json, string.concat(rk, ".recipient"))], "recipient");
            (,,,,,,,, uint128 winningBid) = c.rounds(r);
            assertEq(winningBid, vm.parseJsonUint(json, string.concat(rk, ".winningBid")), "winning bid");

            uint256[] memory dues = vm.parseJsonUintArray(json, string.concat(rk, ".dues"));
            uint256 payout;
            for (uint256 i = 0; i < m.length; i++) {
                assertEq(c.amountDue(m[i]), dues[i], "due");
                if (m[i] == recipient) continue;
                vm.prank(m[i]);
                c.declarePayment(keccak256(abi.encode("slip", r, i)));
                vm.prank(recipient);
                c.confirmReceipt(m[i]);
                (, uint128 paid,) = c.payments(r, m[i]);
                payout += paid;
            }
            assertEq(payout, vm.parseJsonUint(json, string.concat(rk, ".payout")), "payout");

            (uint64 start,,,,,,,,) = c.rounds(r);
            vm.warp(start + p.period);
            c.nextRound();
        }
        assertEq(uint8(c.status()), uint8(Circle.Status.Completed));
        assertEq(factory.activeCircles(m[0]), 0);
    }

    function _bid(Circle c, address[] memory m, uint8 r, string memory rk) internal {
        if (!c.needsBidding(r)) return;
        uint256 n;
        while (vm.keyExistsJson(json, string.concat(rk, ".bids[", vm.toString(n), "]"))) n++;
        uint256[] memory who = new uint256[](n);
        uint256[] memory amt = new uint256[](n);
        for (uint256 b = 0; b < n; b++) {
            string memory bk = string.concat(rk, ".bids[", vm.toString(b), "]");
            who[b] = vm.parseJsonUint(json, string.concat(bk, ".member"));
            amt[b] = vm.parseJsonUint(json, string.concat(bk, ".amount"));
            commitBidAs(c, m[who[b]], uint128(amt[b]));
        }
        (, uint64 biddingEnds, uint64 revealEnds,,,,,,) = c.rounds(r);
        vm.warp(biddingEnds);
        for (uint256 b = 0; b < n; b++) {
            reveal(c, m[who[b]], uint128(amt[b]));
        }
        vm.warp(revealEnds);
        c.closeBidding();
    }
}

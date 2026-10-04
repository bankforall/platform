// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {Test} from "forge-std/Test.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

import {Circle} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Attestation, CircleParams, CircleType} from "../src/CircleTypes.sol";

abstract contract BaseTest is Test {
    uint64 internal constant DAY = 1 days;
    /// Reputation at or above the factory's trustedReputation (110).
    uint32 internal constant TRUSTED = 200;

    CircleFactory internal factory;
    ERC2771Forwarder internal forwarder;
    address internal admin = makeAddr("admin");
    address internal attester;
    uint256 internal attesterKey;

    function setUp() public virtual {
        (attester, attesterKey) = makeAddrAndKey("attester");
        forwarder = new ERC2771Forwarder("BankForAllForwarder");
        factory = new CircleFactory(admin, attester, address(forwarder));
        // general tests use a loose interest cap; Decisions.t.sol tests the real default (15%/year)
        vm.prank(admin);
        factory.setPolicy(60_000, 110, 30 days);
        vm.warp(1_700_000_000);
    }

    function defaultParams(CircleType t, uint8 n) internal pure returns (CircleParams memory) {
        return CircleParams({
            circleType: t,
            hostTakesFirst: true,
            maxMembers: n,
            fixRateBps: 0,
            minReputation: 0,
            principal: 100_000, // 1,000 baht
            period: 30 * DAY,
            bidWindow: DAY,
            revealWindow: DAY,
            paymentWindow: 3 * DAY,
            grace: DAY
        });
    }

    function attest(address subject, address circle, uint32 reputation)
        internal
        view
        returns (Attestation memory att, bytes memory sig)
    {
        att = Attestation(subject, circle, reputation, uint64(block.timestamp + DAY));
        sig = signAttestation(att, attesterKey);
    }

    function signAttestation(Attestation memory att, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, factory.attestationDigest(att));
        return abi.encodePacked(r, s, v);
    }

    function create(address host, CircleParams memory p, uint8 hostSeat, uint32 reputation)
        internal
        returns (Circle)
    {
        (Attestation memory att, bytes memory sig) = attest(host, address(0), reputation);
        vm.prank(host);
        return Circle(factory.createCircle(p, hostSeat, att, sig));
    }

    function joinAs(Circle c, address who, uint8 seat, uint32 reputation) internal {
        (Attestation memory att, bytes memory sig) = attest(who, address(c), reputation);
        vm.prank(who);
        c.join(seat, att, sig);
    }

    /// Creates a circle of `n` members (host = members[0]) with seats in join order, and starts it.
    function startedCircle(CircleParams memory p) internal returns (Circle c, address[] memory m) {
        m = new address[](p.maxMembers);
        for (uint256 i = 0; i < m.length; i++) {
            m[i] = makeAddr(string.concat("member", vm.toString(i)));
        }
        c = create(m[0], p, 0, TRUSTED);
        for (uint8 i = 1; i < m.length; i++) {
            joinAs(c, m[i], i, TRUSTED);
        }
        vm.prank(m[0]);
        c.start();
    }

    function commitBidAs(Circle c, address who, uint128 amount) internal {
        bytes32 salt = keccak256(abi.encode(who, amount));
        bytes32 hash = c.bidHash(c.currentRound(), who, amount, salt); // compute before prank
        vm.prank(who);
        c.commitBid(hash);
    }

    function reveal(Circle c, address who, uint128 amount) internal {
        bytes32 salt = keccak256(abi.encode(who, amount));
        c.revealBid(who, amount, salt); // anyone holding the preimage can reveal
    }

    function recipientOf(Circle c, uint8 r) internal view returns (address recipient) {
        (,,,,,,, recipient,) = c.rounds(r);
    }

    function settleAll(Circle c, address[] memory m) internal {
        uint8 r = c.currentRound();
        address recipient = recipientOf(c, r);
        for (uint256 i = 0; i < m.length; i++) {
            if (m[i] == recipient) continue;
            vm.prank(recipient);
            c.confirmReceipt(m[i]);
        }
    }

    function payStatus(Circle c, uint8 r, address payer) internal view returns (Circle.PayStatus s) {
        (s,,) = c.payments(r, payer);
    }
}

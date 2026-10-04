// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

import {BaseTest} from "./Base.t.sol";
import {Circle} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Attestation, CircleParams, CircleType} from "../src/CircleTypes.sol";

/// @notice Users sign in the browser; the relayer submits through the ERC-2771 forwarder.
contract MetaTxTest is BaseTest {
    bytes32 constant FORWARD_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );
    address relayer = makeAddr("relayer");

    function _forward(uint256 key, address to, bytes memory data) internal returns (bool ok) {
        address from = vm.addr(key);
        ERC2771Forwarder.ForwardRequestData memory req = ERC2771Forwarder.ForwardRequestData({
            from: from,
            to: to,
            value: 0,
            gas: 1_000_000,
            deadline: uint48(block.timestamp + 1 hours),
            data: data,
            signature: ""
        });
        bytes32 structHash = keccak256(
            abi.encode(
                FORWARD_TYPEHASH,
                req.from,
                req.to,
                req.value,
                req.gas,
                forwarder.nonces(from),
                req.deadline,
                keccak256(req.data)
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("BankForAllForwarder"),
                keccak256("1"),
                block.chainid,
                address(forwarder)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        req.signature = abi.encodePacked(r, s, v);
        vm.prank(relayer);
        forwarder.execute(req);
        return true;
    }

    function test_relayedCreateAndJoinAreAttributedToSigners() public {
        (address host, uint256 hostKey) = makeAddrAndKey("host");
        (address alice, uint256 aliceKey) = makeAddrAndKey("alice");

        (Attestation memory att, bytes memory sig) = attest(host, address(0), TRUSTED);
        vm.recordLogs();
        _forward(
            hostKey,
            address(factory),
            abi.encodeCall(CircleFactory.createCircle, (defaultParams(CircleType.Float, 2), 0, att, sig))
        );
        // CircleCreated(address indexed circle, ...) is the factory's first log
        Circle c = Circle(address(uint160(uint256(vm.getRecordedLogs()[0].topics[1]))));
        assertEq(c.host(), host, "host is the signer, not the relayer");
        assertEq(factory.activeCircles(relayer), 0);

        (att, sig) = attest(alice, address(c), TRUSTED);
        _forward(aliceKey, address(c), abi.encodeCall(Circle.join, (0, att, sig)));
        (bool exists,,,,,,) = c.memberInfo(alice);
        assertTrue(exists);

        _forward(hostKey, address(c), abi.encodeCall(Circle.start, ()));
        assertEq(uint8(c.status()), uint8(Circle.Status.Active));
    }

    function test_forgedSignatureIsRejected() public {
        (, uint256 mallory) = makeAddrAndKey("mallory");
        (address host,) = makeAddrAndKey("host");
        Circle c = create(host, defaultParams(CircleType.Float, 2), 0, TRUSTED);

        ERC2771Forwarder.ForwardRequestData memory req = ERC2771Forwarder.ForwardRequestData({
            from: host, // claims to be the host…
            to: address(c),
            value: 0,
            gas: 500_000,
            deadline: uint48(block.timestamp + 1 hours),
            data: abi.encodeCall(Circle.cancel, ()),
            signature: ""
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(mallory, keccak256("anything")); // …but mallory signs
        req.signature = abi.encodePacked(r, s, v);
        vm.prank(relayer);
        vm.expectRevert();
        forwarder.execute(req);
        assertEq(uint8(c.status()), uint8(Circle.Status.Open));
    }
}

contract RotationTest is BaseTest {
    Circle c;
    address[] m;
    address fresh = makeAddr("new-phone");

    function setUp() public override {
        super.setUp();
        (c, m) = startedCircle(defaultParams(CircleType.Float, 3));
    }

    function _rotation(address oldMember, address newMember)
        internal
        view
        returns (uint64 deadline, bytes memory sig)
    {
        deadline = uint64(block.timestamp + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(attesterKey, factory.keyRotationDigest(address(c), oldMember, newMember, deadline));
        sig = abi.encodePacked(r, s, v);
    }

    function test_rotatePayerMidRound() public {
        vm.prank(m[1]);
        c.declarePayment(keccak256("slip"));

        (uint64 deadline, bytes memory sig) = _rotation(m[1], fresh);
        c.rotateMember(m[1], fresh, deadline, sig);

        assertEq(c.members()[1], fresh);
        (bool oldExists,,,,,,) = c.memberInfo(m[1]);
        assertFalse(oldExists);
        assertEq(uint8(payStatus(c, 1, fresh)), uint8(Circle.PayStatus.Declared), "payment moved");

        vm.prank(m[0]);
        c.confirmReceipt(fresh);
        vm.prank(m[0]);
        vm.expectRevert(Circle.NotMember.selector);
        c.confirmReceipt(m[1]);
    }

    function test_rotateHostMovesHostingSlot() public {
        (uint64 deadline, bytes memory sig) = _rotation(m[0], fresh);
        c.rotateMember(m[0], fresh, deadline, sig);
        assertEq(c.host(), fresh);
        assertEq(recipientOf(c, 1), fresh, "current recipient follows the key");
        assertEq(factory.activeCircles(m[0]), 0);
        assertEq(factory.activeCircles(fresh), 1);
    }

    function test_rotationNeedsAttesterAndFreshAddress() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        (, uint256 otherKey) = makeAddrAndKey("other");
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(otherKey, factory.keyRotationDigest(address(c), m[1], fresh, deadline));
        vm.expectRevert(CircleFactory.InvalidAttestation.selector);
        c.rotateMember(m[1], fresh, deadline, abi.encodePacked(r, s, v));

        bytes memory sig;
        (deadline, sig) = _rotation(m[1], m[2]);
        vm.expectRevert(Circle.AlreadyMember.selector);
        c.rotateMember(m[1], m[2], deadline, sig);

        (deadline, sig) = _rotation(m[1], fresh);
        vm.warp(deadline + 1);
        vm.expectRevert(CircleFactory.InvalidAttestation.selector);
        c.rotateMember(m[1], fresh, deadline, sig);
    }

    function test_onlyCirclesCanRotateHosts() public {
        vm.expectRevert(CircleFactory.NotCircle.selector);
        factory.onHostRotated(m[0], fresh);
    }
}

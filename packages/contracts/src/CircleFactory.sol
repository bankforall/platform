// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {Circle} from "./Circle.sol";
import {Attestation, CircleParams, CircleType} from "./CircleTypes.sol";

/// @title CircleFactory
/// @notice Creates peer-share circles (one EIP-1167 clone of `Circle` per circle), enforces the
///         legal caps of the Chit Fund Act B.E. 2534 and verifies backend KYC attestations.
/// @dev No function moves money: circles only record what members transfer to each other off-chain.
///      Users sign their actions in the browser; a relayer submits them through the trusted
///      ERC-2771 forwarder and pays the gas, so `_msgSender()` is always the signing user.
contract CircleFactory is AccessControl, Pausable, EIP712, ERC2771Context {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(address subject,address circle,uint32 reputation,uint64 deadline)");
    bytes32 public constant KEY_ROTATION_TYPEHASH =
        keccak256("KeyRotation(address circle,address oldMember,address newMember,uint64 deadline)");

    /// @notice Defaults follow our reading of the Act — NOT legally verified; confirm before launch.
    uint8 public maxMembersCap = 30;
    /// @notice Cap on principal × maxMembers, in satang (300,000 baht).
    uint256 public maxPoolValue = 300_000 * 100;
    uint8 public maxActiveCirclesPerHost = 3;
    uint16 public constant MAX_FIX_RATE_BPS = 5_000;

    address public immutable implementation;
    mapping(address => bool) public isCircle;
    mapping(address => uint8) public activeCircles;

    event CircleCreated(address indexed circle, address indexed host, CircleParams params);
    event CapsUpdated(uint8 maxMembersCap, uint256 maxPoolValue, uint8 maxActiveCirclesPerHost);
    event HostRotated(address indexed circle, address indexed oldHost, address indexed newHost);

    error InvalidAttestation();
    error InvalidParams();
    error OverLegalCap();
    error NotCircle();

    constructor(address admin, address attester, address forwarder)
        EIP712("BankForAll", "1")
        ERC2771Context(forwarder)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTER_ROLE, attester);
        implementation = address(new Circle(forwarder));
    }

    /// @notice Creates a circle hosted by the caller, who must hold a host attestation
    ///         (`circle == address(0)`). `hostSeat` is only used by Fix circles.
    function createCircle(
        CircleParams calldata p,
        uint8 hostSeat,
        Attestation calldata att,
        bytes calldata sig
    ) external whenNotPaused returns (address circle) {
        address host = _msgSender();
        if (att.subject != host || att.circle != address(0)) {
            revert InvalidAttestation();
        }
        verifyAttestation(att, sig);
        _validate(p, hostSeat);
        if (activeCircles[host] >= maxActiveCirclesPerHost) revert OverLegalCap();

        circle = Clones.clone(implementation);
        isCircle[circle] = true;
        activeCircles[host] += 1;
        Circle(circle).initialize(p, host, hostSeat, att.reputation);
        emit CircleCreated(circle, host, p);
    }

    /// @notice Reverts unless `sig` is a current attestation signed by an ATTESTER.
    function verifyAttestation(Attestation calldata att, bytes calldata sig) public view {
        if (att.deadline < block.timestamp) revert InvalidAttestation();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(ATTESTATION_TYPEHASH, att.subject, att.circle, att.reputation, att.deadline))
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || !hasRole(ATTESTER_ROLE, signer)) {
            revert InvalidAttestation();
        }
    }

    /// @notice Reverts unless an ATTESTER approved replacing `oldMember`'s key with `newMember`
    ///         in `circle` (after re-verifying the person's identity, e.g. when a phone is lost).
    function verifyKeyRotation(
        address circle,
        address oldMember,
        address newMember,
        uint64 deadline,
        bytes calldata sig
    ) external view {
        if (deadline < block.timestamp) revert InvalidAttestation();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(KEY_ROTATION_TYPEHASH, circle, oldMember, newMember, deadline))
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || !hasRole(ATTESTER_ROLE, signer)) {
            revert InvalidAttestation();
        }
    }

    function keyRotationDigest(address circle, address oldMember, address newMember, uint64 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(KEY_ROTATION_TYPEHASH, circle, oldMember, newMember, deadline))
        );
    }

    function attestationDigest(Attestation calldata att) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ATTESTATION_TYPEHASH, att.subject, att.circle, att.reputation, att.deadline))
        );
    }

    /// @notice Called by a circle when it completes or is cancelled, freeing a hosting slot.
    function onCircleClosed(address host) external {
        if (!isCircle[msg.sender]) revert NotCircle();
        activeCircles[host] -= 1;
    }

    /// @notice Called by an active circle when its host's key is rotated, moving the hosting slot.
    function onHostRotated(address oldHost, address newHost) external {
        if (!isCircle[msg.sender]) revert NotCircle();
        activeCircles[oldHost] -= 1;
        activeCircles[newHost] += 1;
        emit HostRotated(msg.sender, oldHost, newHost);
    }

    function setCaps(uint8 members, uint256 poolValue, uint8 activePerHost)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        maxMembersCap = members;
        maxPoolValue = poolValue;
        maxActiveCirclesPerHost = activePerHost;
        emit CapsUpdated(members, poolValue, activePerHost);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _validate(CircleParams calldata p, uint8 hostSeat) private view {
        if (p.maxMembers < 2 || p.principal == 0 || p.period == 0) revert InvalidParams();
        if (p.bidWindow == 0 || p.revealWindow == 0 || p.paymentWindow == 0) revert InvalidParams();
        if (uint256(p.bidWindow) + p.revealWindow + p.paymentWindow + p.grace > p.period) {
            revert InvalidParams();
        }
        if (p.circleType == CircleType.Fix) {
            if (p.fixRateBps > MAX_FIX_RATE_BPS || hostSeat >= p.maxMembers) revert InvalidParams();
        } else if (p.fixRateBps != 0) {
            revert InvalidParams();
        }
        if (p.maxMembers > maxMembersCap) revert OverLegalCap();
        if (uint256(p.principal) * p.maxMembers > maxPoolValue) revert OverLegalCap();
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}

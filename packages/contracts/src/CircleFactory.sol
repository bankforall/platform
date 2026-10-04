// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
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
///      The admin (a Safe multisig in production) can only be handed over in two steps with a
///      delay, so a mistyped or compromised transfer can be cancelled; a separate pauser key can
///      stop the system in an emergency but only the admin can resume it.
contract CircleFactory is AccessControlDefaultAdminRules, Pausable, EIP712, ERC2771Context {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice Initial wait between starting and accepting an admin handover (changeable, itself delayed).
    uint48 public constant INITIAL_ADMIN_DELAY = 2 days;
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(address subject,address circle,uint32 reputation,uint64 deadline)");
    bytes32 public constant KEY_ROTATION_TYPEHASH =
        keccak256("KeyRotation(address circle,address oldMember,address newMember,uint64 deadline)");

    /// @notice Defaults follow our reading of the Act — NOT legally verified; confirm before launch.
    uint8 public maxMembersCap = 30;
    /// @notice Cap on principal × maxMembers, in satang (300,000 baht).
    uint256 public maxPoolValue = 300_000 * 100;
    uint8 public maxActiveCirclesPerHost = 3;

    /// @notice Annualised cap on interest bids, discounts and Fix rate ladders (15%/year until a legal
    ///         opinion says otherwise). Applies to circles created after a change.
    uint16 public maxAnnualRateBps = 1_500;
    /// @notice Reputation needed to receive in the first half of a circle or to take the host's first round.
    uint32 public trustedReputation = 110;
    /// @notice A circle that has not started this long after creation may be cancelled by anyone.
    uint64 public openTtl = 30 days;
    /// @notice Last unpause: payment deadlines are extended past it so nobody defaults because of a pause.
    uint64 public lastUnpausedAt;
    uint16 public constant MAX_FIX_RATE_BPS = 5_000;

    address public immutable implementation;
    mapping(address => bool) public isCircle;
    mapping(address => uint8) public activeCircles;

    event CircleCreated(address indexed circle, address indexed host, CircleParams params);
    event CapsUpdated(uint8 maxMembersCap, uint256 maxPoolValue, uint8 maxActiveCirclesPerHost);
    event HostRotated(address indexed circle, address indexed oldHost, address indexed newHost);
    event PolicyUpdated(uint16 maxAnnualRateBps, uint32 trustedReputation, uint64 openTtl);

    error InvalidAttestation();
    error InvalidParams();
    error OverLegalCap();
    error NotCircle();

    constructor(address admin, address attester, address forwarder)
        AccessControlDefaultAdminRules(INITIAL_ADMIN_DELAY, admin)
        EIP712("BankForAll", "1")
        ERC2771Context(forwarder)
    {
        if (admin == address(0) || attester == address(0) || forwarder == address(0)) revert InvalidParams();
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
        emit CircleCreated(circle, host, p);
        Circle(circle).initialize(p, host, hostSeat, att.reputation);
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

    function setPolicy(uint16 annualRateBps, uint32 trustedRep, uint64 ttl)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (ttl == 0) revert InvalidParams();
        maxAnnualRateBps = annualRateBps;
        trustedReputation = trustedRep;
        openTtl = ttl;
        emit PolicyUpdated(annualRateBps, trustedRep, ttl);
    }

    /// @notice Largest interest bid / discount per round allowed for these parameters.
    function bidCap(uint128 principal, uint64 period) public view returns (uint128) {
        return uint128((uint256(principal) * maxAnnualRateBps * period) / (365 days * 10_000));
    }

    error NotPauser();

    /// @notice Emergency stop: the admin or a holder of PAUSER_ROLE (a hot ops key) may pause.
    function pause() external {
        address sender = _msgSender();
        if (!hasRole(PAUSER_ROLE, sender) && sender != defaultAdmin()) revert NotPauser();
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        lastUnpausedAt = uint64(block.timestamp);
        _unpause();
    }

    function _validate(CircleParams calldata p, uint8 hostSeat) private view {
        if (p.maxMembers < 2 || p.principal == 0 || p.period == 0) revert InvalidParams();
        if (p.bidWindow == 0 || p.revealWindow == 0 || p.paymentWindow == 0 || p.grace == 0) {
            revert InvalidParams();
        }
        // payment window, then grace to pay (default after), then grace for the recipient to reject
        if (uint256(p.bidWindow) + p.revealWindow + p.paymentWindow + 2 * uint256(p.grace) > p.period) {
            revert InvalidParams();
        }
        if (p.circleType == CircleType.Fix) {
            if (p.fixRateBps > MAX_FIX_RATE_BPS || hostSeat >= p.maxMembers) revert InvalidParams();
            // the seat ladder is interest too: per-round rate within the annualised cap
            if (uint256(p.fixRateBps) * 365 days > uint256(maxAnnualRateBps) * p.period) {
                revert OverLegalCap();
            }
        } else {
            if (p.fixRateBps != 0) revert InvalidParams();
            // a bidding circle needs room for at least a 1-satang bid
            if (bidCap(p.principal, p.period) == 0) revert InvalidParams();
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

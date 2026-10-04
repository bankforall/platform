// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

import {CircleFactory} from "./CircleFactory.sol";
import {Attestation, CircleParams, CircleType} from "./CircleTypes.sol";

/// @title Circle
/// @notice One peer-share circle (เปียแชร์ / ROSCA). It decides who receives the pool each round and
///         keeps a tamper-proof record of every bid, payment, confirmation and default.
/// @dev The contract never holds money: members transfer baht to the round's recipient off-chain
///      (PromptPay) and record it here. Recipient selection and dues mirror
///      packages/shared/src/circle-math.ts and are checked against the same test vectors.
///
///      Round lifecycle: (sealed bidding → reveal →) recipient selected → members pay →
///      every payer confirmed or in default → next round after `period`.
contract Circle is Initializable, ERC2771Context {
    enum Status {
        Open,
        Active,
        Completed,
        Cancelled
    }

    enum PayStatus {
        None,
        Declared,
        Attested,
        Confirmed,
        Defaulted
    }

    struct Member {
        bool exists;
        bool hasWon;
        bool defaulted;
        uint8 index;
        uint8 seat;
        uint32 reputation;
        uint128 wonBid;
    }

    struct Round {
        uint64 start;
        uint64 biddingEnds;
        uint64 revealEnds;
        uint64 paymentDeadline;
        bool bidding;
        bool decided;
        uint8 settled;
        address recipient;
        uint128 winningBid;
    }

    struct Commit {
        bytes32 hash;
        uint32 order;
        bool revealed;
    }

    struct BestBid {
        bool exists;
        address bidder;
        uint128 amount;
        uint32 reputation;
        uint32 order;
    }

    struct Payment {
        PayStatus status;
        uint128 amount;
        bytes32 slipHash;
    }

    uint256 private constant BPS = 10_000;

    CircleFactory public factory;
    address public host;
    CircleParams internal _params;
    Status public status;
    uint8 public currentRound;

    address[] internal _members;
    mapping(address => Member) public memberInfo;
    /// @notice Fix circles: owner of each seat (seat k receives the pool in round k + 1).
    mapping(uint8 => address) public seatOwner;

    mapping(uint8 => Round) public rounds;
    mapping(uint8 => mapping(address => Commit)) public commits;
    mapping(uint8 => uint32) internal _commitCount;
    mapping(uint8 => BestBid) internal _best;
    mapping(uint8 => mapping(address => Payment)) public payments;
    /// @notice Unpaid amounts from defaults: owed[debtor][creditor]. Set off automatically when the
    ///         debtor receives the pool (the creditor then pays the debtor that much less).
    mapping(address => mapping(address => uint128)) public owed;
    /// @dev Best revealed bid among trusted members (used in the first half of the circle).
    mapping(uint8 => BestBid) internal _bestTrusted;

    /// @notice Policy snapshot taken from the factory at creation.
    uint128 internal _maxBid;
    uint32 public trustedReputation;
    /// @notice After this, anyone may cancel the circle if it has not started.
    uint64 public openUntil;

    event MemberJoined(address indexed member, uint8 index, uint8 seat, uint32 reputation);
    event CircleStarted(uint64 startedAt);
    event CircleCancelled();
    event CircleCompleted();
    event RoundOpened(uint8 indexed round, bool bidding, uint64 biddingEnds, uint64 revealEnds);
    event BidCommitted(uint8 indexed round, address indexed member, bytes32 hash);
    event BidRevealed(uint8 indexed round, address indexed member, uint128 amount);
    event RecipientSelected(
        uint8 indexed round, address indexed recipient, uint128 winningBid, uint64 paymentDeadline
    );
    event PaymentDeclared(
        uint8 indexed round,
        address indexed payer,
        address indexed recipient,
        uint128 amount,
        bytes32 slipHash
    );
    event SlipAttested(uint8 indexed round, address indexed payer, bytes32 slipHash);
    event PaymentConfirmed(
        uint8 indexed round, address indexed payer, address indexed recipient, uint128 amount
    );
    event MemberDefaulted(
        uint8 indexed round, address indexed payer, address indexed recipient, uint128 amount
    );
    event PaymentRejected(uint8 indexed round, address indexed payer, address indexed recipient);
    event PaymentAccepted(
        uint8 indexed round, address indexed payer, address indexed recipient, uint128 amount
    );
    event Disputed(uint8 indexed round, address indexed member, bytes32 reasonHash);
    event MemberRotated(address indexed oldMember, address indexed newMember);
    /// @notice `offset` of what `payer` owes this round's recipient was set off against the recipient's
    ///         unpaid debt to `payer`; `remaining` is what still has to be transferred.
    event PaymentOffset(
        uint8 indexed round,
        address indexed payer,
        address indexed recipient,
        uint128 offset,
        uint128 remaining
    );

    error WrongStatus();
    error NotHost();
    error NotMember();
    error Paused();
    error CircleFull();
    error AlreadyMember();
    error ReputationTooLow();
    error SeatTaken();
    error InvalidSeat();
    error NotReady();
    error NotEligible();
    error OutsideWindow();
    error AlreadyCommitted();
    error BadReveal();
    error BidTooHigh();
    error AlreadyDecided();
    error NotDecided();
    error NotRecipient();
    error IsRecipient();
    error BadPaymentStatus();
    error NotAttester();
    error SlipMismatch();
    error TooEarly();
    error NotTrusted();

    modifier whenNotPaused() {
        if (factory.paused()) revert Paused();
        _;
    }

    modifier inStatus(Status s) {
        if (status != s) revert WrongStatus();
        _;
    }

    /// @dev The forwarder is an immutable of the implementation, so every clone trusts it too.
    constructor(address forwarder) ERC2771Context(forwarder) {
        _disableInitializers();
    }

    function initialize(CircleParams calldata p, address host_, uint8 hostSeat, uint32 hostReputation)
        external
        initializer
    {
        if (host_ == address(0)) revert NotHost();
        factory = CircleFactory(msg.sender);
        host = host_;
        _params = p;
        trustedReputation = factory.trustedReputation();
        openUntil = uint64(block.timestamp) + factory.openTtl();
        uint128 cap = p.circleType == CircleType.Discount ? p.principal - 1 : p.principal;
        uint128 policyCap = factory.bidCap(p.principal, p.period);
        _maxBid = p.circleType == CircleType.Fix ? 0 : (policyCap < cap ? policyCap : cap);
        // the host's first round (มือนายวง) only for a trusted host
        if (p.hostTakesFirst && p.circleType != CircleType.Fix && hostReputation < trustedReputation) {
            revert NotTrusted();
        }
        _addMember(host_, hostSeat, hostReputation);
    }

    // ───────────────────────────── membership ─────────────────────────────

    /// @notice Joins the circle with a backend attestation bound to this circle.
    /// @param seat chosen seat for Fix circles; ignored otherwise.
    function join(uint8 seat, Attestation calldata att, bytes calldata sig)
        external
        whenNotPaused
        inStatus(Status.Open)
    {
        if (att.subject != _msgSender() || att.circle != address(this)) revert NotEligible();
        factory.verifyAttestation(att, sig);
        if (memberInfo[_msgSender()].exists) revert AlreadyMember();
        if (_members.length >= _params.maxMembers) revert CircleFull();
        if (att.reputation < _params.minReputation) revert ReputationTooLow();
        _addMember(_msgSender(), seat, att.reputation);
    }

    /// @notice Host cancels a circle that has not started; after `openUntil` anyone may.
    function cancel() external inStatus(Status.Open) {
        if (_msgSender() != host && block.timestamp <= openUntil) revert NotHost();
        status = Status.Cancelled;
        emit CircleCancelled();
        factory.onCircleClosed(host);
    }

    /// @notice Host starts the circle once every seat is filled; round 1 opens immediately.
    function start() external whenNotPaused inStatus(Status.Open) {
        if (_msgSender() != host) revert NotHost();
        if (_members.length != _params.maxMembers) revert NotReady();
        status = Status.Active;
        emit CircleStarted(uint64(block.timestamp));
        _openRound(1);
    }

    // ───────────────────────────── bidding ─────────────────────────────

    /// @notice Sealed bid: `hash = keccak256(abi.encode(circle, round, member, amount, salt))`.
    function commitBid(bytes32 hash) external whenNotPaused inStatus(Status.Active) {
        uint8 r = currentRound;
        Round storage rd = rounds[r];
        if (!rd.bidding || block.timestamp >= rd.biddingEnds) revert OutsideWindow();
        if (!_eligible(_msgSender())) revert NotEligible();
        Commit storage c = commits[r][_msgSender()];
        if (c.hash != bytes32(0)) revert AlreadyCommitted();
        c.hash = hash;
        c.order = ++_commitCount[r];
        emit BidCommitted(r, _msgSender(), hash);
    }

    /// @notice Opens a sealed bid. Anyone holding the preimage may reveal it (the hash binds the
    ///         member), so the backend keeper can reveal for members who are offline.
    function revealBid(address member, uint128 amount, bytes32 salt)
        external
        whenNotPaused
        inStatus(Status.Active)
    {
        uint8 r = currentRound;
        Round storage rd = rounds[r];
        if (!rd.bidding || block.timestamp < rd.biddingEnds || block.timestamp >= rd.revealEnds) {
            revert OutsideWindow();
        }
        if (!memberInfo[member].exists) revert NotMember();
        Commit storage c = commits[r][member];
        if (c.hash == bytes32(0) || c.revealed || c.hash != bidHash(r, member, amount, salt)) {
            revert BadReveal();
        }
        if (amount > maxBid()) revert BidTooHigh();
        c.revealed = true;

        uint32 rep = memberInfo[member].reputation;
        if (_beats(_best[r], amount, rep, c.order)) _best[r] = BestBid(true, member, amount, rep, c.order);
        if (rep >= trustedReputation && _beats(_bestTrusted[r], amount, rep, c.order)) {
            _bestTrusted[r] = BestBid(true, member, amount, rep, c.order);
        }
        emit BidRevealed(r, member, amount);
    }

    /// @notice Anyone (normally the backend keeper) selects the recipient after the reveal window.
    function closeBidding() external whenNotPaused inStatus(Status.Active) {
        Round storage rd = rounds[currentRound];
        if (rd.decided) revert AlreadyDecided();
        if (block.timestamp < rd.revealEnds) revert OutsideWindow();
        _decide(currentRound);
    }

    // ───────────────────────────── payments ─────────────────────────────

    /// @notice Payer records a transfer to the current recipient, with the hash of the slip image.
    function declarePayment(bytes32 slipHash) external whenNotPaused inStatus(Status.Active) {
        uint8 r = currentRound;
        _requirePayer(r, _msgSender());
        Payment storage pay = payments[r][_msgSender()];
        if (pay.status != PayStatus.None) revert BadPaymentStatus();
        if (block.timestamp > _defaultAfter(r)) revert OutsideWindow();
        uint128 due = amountDue(_msgSender());
        payments[r][_msgSender()] = Payment(PayStatus.Declared, due, slipHash);
        emit PaymentDeclared(r, _msgSender(), rounds[r].recipient, due, slipHash);
    }

    /// @notice Backend confirms the slip was verified with the bank/slip-verification API.
    ///         A verified payment counts as settled and can no longer be rejected or defaulted.
    function attestSlip(address payer, bytes32 slipHash) external whenNotPaused inStatus(Status.Active) {
        if (!factory.hasRole(factory.ATTESTER_ROLE(), _msgSender())) revert NotAttester();
        uint8 r = currentRound;
        Payment storage pay = payments[r][payer];
        if (pay.status != PayStatus.Declared) revert BadPaymentStatus();
        if (pay.slipHash != slipHash) revert SlipMismatch();
        pay.status = PayStatus.Attested; // a bank-verified slip settles the payment
        rounds[r].settled += 1;
        emit SlipAttested(r, payer, slipHash);
    }

    /// @notice The recipient confirms receiving `payer`'s money. This is what settles a payment;
    ///         it also works for cash payments without a slip and for late payments after a default.
    function confirmReceipt(address payer) external whenNotPaused inStatus(Status.Active) {
        uint8 r = currentRound;
        _requirePayer(r, payer);
        if (_msgSender() != rounds[r].recipient) revert NotRecipient();
        Payment storage pay = payments[r][payer];
        if (pay.status == PayStatus.Confirmed) revert BadPaymentStatus();
        if (pay.status == PayStatus.Defaulted) {
            // late payment cures the debt recorded at default (never below zero)
            uint128 debt = owed[payer][_msgSender()];
            owed[payer][_msgSender()] = debt > pay.amount ? debt - pay.amount : 0;
        }
        if (!_settled(pay.status)) rounds[r].settled += 1;
        pay.status = PayStatus.Confirmed;
        emit PaymentConfirmed(r, payer, _msgSender(), pay.amount);
    }

    /// @notice The recipient states that a declared transfer never arrived. The payment goes back to
    ///         unpaid (the payer may declare again until the default time). Only possible until
    ///         `paymentDeadline + 2 * grace` and never for bank-verified (attested) slips.
    function rejectPayment(address payer) external whenNotPaused inStatus(Status.Active) {
        uint8 r = currentRound;
        _requirePayer(r, payer);
        if (_msgSender() != rounds[r].recipient) revert NotRecipient();
        Payment storage pay = payments[r][payer];
        if (pay.status != PayStatus.Declared) revert BadPaymentStatus();
        if (block.timestamp > _acceptAfter(r)) revert OutsideWindow();
        pay.status = PayStatus.None;
        pay.slipHash = bytes32(0);
        emit PaymentRejected(r, payer, _msgSender());
    }

    /// @notice A declared payment the recipient neither confirmed nor rejected in time is accepted.
    ///         This stops a recipient from griefing honest payers into default by staying silent.
    function acceptDeclared(address payer) external whenNotPaused inStatus(Status.Active) {
        uint8 r = currentRound;
        _requirePayer(r, payer);
        Payment storage pay = payments[r][payer];
        if (pay.status != PayStatus.Declared) revert BadPaymentStatus();
        if (block.timestamp <= _acceptAfter(r)) revert TooEarly();
        pay.status = PayStatus.Confirmed;
        rounds[r].settled += 1;
        emit PaymentAccepted(r, payer, rounds[r].recipient, pay.amount);
    }

    /// @notice Anyone can record a default once the payment window plus grace period has passed and
    ///         the payer has not declared a payment. The member keeps their obligations but can no
    ///         longer bid or receive the pool first.
    function markDefault(address payer) external whenNotPaused inStatus(Status.Active) {
        uint8 r = currentRound;
        _requirePayer(r, payer);
        Round storage rd = rounds[r];
        if (block.timestamp <= _defaultAfter(r)) revert TooEarly();
        Payment storage pay = payments[r][payer];
        if (pay.status != PayStatus.None) revert BadPaymentStatus();
        pay.status = PayStatus.Defaulted;
        memberInfo[payer].defaulted = true;
        owed[payer][rd.recipient] += pay.amount;
        rd.settled += 1;
        emit MemberDefaulted(r, payer, rd.recipient, pay.amount);
    }

    /// @notice Opens the next round (or completes the circle) once every payment of the current
    ///         round is confirmed or in default and `period` has elapsed.
    function nextRound() external whenNotPaused inStatus(Status.Active) {
        Round storage rd = rounds[currentRound];
        if (!rd.decided || rd.settled < _params.maxMembers - 1) revert NotReady();
        if (block.timestamp < uint256(rd.start) + _params.period) revert TooEarly();
        if (currentRound == _params.maxMembers) {
            status = Status.Completed;
            emit CircleCompleted();
            factory.onCircleClosed(host);
        } else {
            _openRound(currentRound + 1);
        }
    }

    /// @notice Records that a member disputes something in `round`; resolution happens off-chain.
    function dispute(uint8 round, bytes32 reasonHash) external {
        if (!memberInfo[_msgSender()].exists) revert NotMember();
        emit Disputed(round, _msgSender(), reasonHash);
    }

    /// @notice Replaces a member's key (lost or compromised device) with an ATTESTER approval
    ///         given after re-verifying the person's identity. History stays under the old address;
    ///         the membership, seat, win and default status and the current round move to the new one.
    ///         An unrevealed sealed bid of the old key is discarded (it is bound to the old address);
    ///         the member may commit again with the new key while the commit window is open.
    function rotateMember(address oldMember, address newMember, uint64 deadline, bytes calldata sig)
        external
        whenNotPaused
    {
        if (status != Status.Open && status != Status.Active) revert WrongStatus();
        factory.verifyKeyRotation(address(this), oldMember, newMember, deadline, sig);
        Member memory m = memberInfo[oldMember];
        if (!m.exists) revert NotMember();
        if (newMember == address(0) || memberInfo[newMember].exists) revert AlreadyMember();

        delete memberInfo[oldMember];
        memberInfo[newMember] = m;
        _members[m.index] = newMember;
        if (_params.circleType == CircleType.Fix) seatOwner[m.seat] = newMember;

        uint8 r = currentRound;
        if (r != 0) {
            Round storage rd = rounds[r];
            if (rd.recipient == oldMember) rd.recipient = newMember;
            payments[r][newMember] = payments[r][oldMember];
            delete payments[r][oldMember];
            if (_best[r].bidder == oldMember) _best[r].bidder = newMember;
            if (!commits[r][oldMember].revealed) delete commits[r][oldMember];
        }
        uint256 count = _members.length;
        for (uint256 i = 0; i < count; i++) {
            address other = _members[i];
            if (other == newMember) continue;
            owed[newMember][other] = owed[oldMember][other];
            delete owed[oldMember][other];
            owed[other][newMember] = owed[other][oldMember];
            delete owed[other][oldMember];
        }
        emit MemberRotated(oldMember, newMember);
        if (host == oldMember) {
            host = newMember;
            factory.onHostRotated(oldMember, newMember);
        }
    }

    // ───────────────────────────── views ─────────────────────────────

    function params() external view returns (CircleParams memory) {
        return _params;
    }

    function members() external view returns (address[] memory) {
        return _members;
    }

    function bidHash(uint8 round, address member, uint128 amount, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(this), round, member, amount, salt));
    }

    function needsBidding(uint8 round) public view returns (bool) {
        if (_params.circleType == CircleType.Fix) return false;
        if (round == 1 && _params.hostTakesFirst) return false;
        return round < _params.maxMembers;
    }

    /// @notice Largest interest bid (Float) or discount (Discount) per round: the policy cap taken
    ///         at creation, never more than the principal.
    function maxBid() public view returns (uint128) {
        return _maxBid;
    }

    /// @notice Rounds 1..⌊N/2⌋ prefer trusted members as recipients.
    function isEarlyRound(uint8 round) public view returns (bool) {
        return round <= _params.maxMembers / 2;
    }

    /// @notice Per-round payment of a Fix seat: linear ladder from +fixRateBps to -fixRateBps.
    function seatPayment(uint8 seat) public view returns (uint128) {
        int256 n = int256(uint256(_params.maxMembers));
        int256 p = int256(uint256(_params.principal));
        int256 step = n - 1 - 2 * int256(uint256(seat));
        int256 adj = (p * int256(uint256(_params.fixRateBps)) * step) / ((n - 1) * int256(BPS));
        return uint128(uint256(p + adj));
    }

    /// @notice What `payer` still has to transfer to the recipient of the current (decided) round,
    ///         after any set-off (fixed when the recipient was selected).
    function amountDue(address payer) public view returns (uint128) {
        Round storage rd = rounds[currentRound];
        if (!rd.decided) revert NotDecided();
        if (!memberInfo[payer].exists) revert NotMember();
        if (payer == rd.recipient) return 0;
        return payments[currentRound][payer].amount;
    }

    /// @notice Contribution owed by `payer` this round before any set-off (the circle rules).
    function baseDue(address payer) public view returns (uint128) {
        Round storage rd = rounds[currentRound];
        Member storage m = memberInfo[payer];
        CircleType t = _params.circleType;
        if (t == CircleType.Fix) return seatPayment(m.seat);
        if (t == CircleType.Float) return m.hasWon ? _params.principal + m.wonBid : _params.principal;
        return m.hasWon ? _params.principal : _params.principal - rd.winningBid;
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _addMember(address who, uint8 seat, uint32 reputation) private {
        uint8 index = uint8(_members.length);
        if (_params.circleType == CircleType.Fix) {
            if (seat >= _params.maxMembers) revert InvalidSeat();
            if (seatOwner[seat] != address(0)) revert SeatTaken();
            // seats that receive in the first half are for trusted members only
            if (seat < _params.maxMembers / 2 && reputation < trustedReputation) revert NotTrusted();
            seatOwner[seat] = who;
        } else {
            seat = index;
        }
        _members.push(who);
        memberInfo[who] = Member(true, false, false, index, seat, reputation, 0);
        emit MemberJoined(who, index, seat, reputation);
    }

    function _openRound(uint8 r) private {
        currentRound = r;
        Round storage rd = rounds[r];
        rd.start = uint64(block.timestamp);
        if (needsBidding(r)) {
            rd.bidding = true;
            rd.biddingEnds = uint64(block.timestamp) + _params.bidWindow;
            rd.revealEnds = rd.biddingEnds + _params.revealWindow;
            emit RoundOpened(r, true, rd.biddingEnds, rd.revealEnds);
        } else {
            emit RoundOpened(r, false, 0, 0);
            _decide(r);
        }
    }

    function _decide(uint8 r) private {
        Round storage rd = rounds[r];
        address recipient = address(0);
        uint128 winningBid = 0;
        // early rounds: if any trusted member can still receive, only a trusted member receives
        bool trustedOnly = rd.bidding && isEarlyRound(r) && _fallbackRecipient(true) != address(0);
        BestBid storage best = trustedOnly ? _bestTrusted[r] : _best[r];
        if (rd.bidding && best.exists && _eligible(best.bidder)) {
            recipient = best.bidder;
            winningBid = best.amount;
        } else {
            recipient = trustedOnly ? _fallbackRecipient(true) : _fallbackRecipient(false);
        }
        rd.recipient = recipient;
        rd.winningBid = winningBid;
        rd.decided = true;
        rd.paymentDeadline = uint64(block.timestamp) + _params.paymentWindow;
        Member storage m = memberInfo[recipient];
        m.hasWon = true;
        m.wonBid = winningBid;
        emit RecipientSelected(r, recipient, winningBid, rd.paymentDeadline);
        _settleDues(r, recipient);
    }

    /// @dev Fixes every payer's due for round `r` and applies set-off against the recipient's debts.
    function _settleDues(uint8 r, address recipient) private {
        uint256 count = _members.length;
        for (uint256 i = 0; i < count; i++) {
            address payer = _members[i];
            if (payer == recipient) continue;
            uint128 due = baseDue(payer);
            uint128 debt = owed[recipient][payer];
            uint128 offset = debt < due ? debt : due;
            Payment storage pay = payments[r][payer];
            pay.amount = due - offset;
            if (offset > 0) {
                owed[recipient][payer] = debt - offset;
                emit PaymentOffset(r, payer, recipient, offset, due - offset);
            }
            if (due == offset) {
                pay.status = PayStatus.Confirmed; // nothing left to transfer
                rounds[r].settled += 1;
            }
        }
    }

    /// @dev First eligible member in priority order (seat order for Fix, join order otherwise).
    ///      `trustedOnly`: only trusted members, returning 0x0 if there is none.
    ///      Otherwise, if every remaining member is in default, the first one who has not received.
    function _fallbackRecipient(bool trustedOnly) private view returns (address) {
        uint8 n = _params.maxMembers;
        bool fix = _params.circleType == CircleType.Fix;
        address firstUnwon = address(0);
        for (uint8 i = 0; i < n; i++) {
            address who = fix ? seatOwner[i] : _members[i];
            Member storage m = memberInfo[who];
            if (m.hasWon) continue;
            if (trustedOnly) {
                if (!m.defaulted && m.reputation >= trustedReputation) return who;
                continue;
            }
            if (!m.defaulted) return who;
            if (firstUnwon == address(0)) firstUnwon = who;
        }
        return firstUnwon;
    }

    function _beats(BestBid storage best, uint128 amount, uint32 rep, uint32 order)
        private
        view
        returns (bool)
    {
        return !best.exists || amount > best.amount || (amount == best.amount && rep > best.reputation)
            || (amount == best.amount && rep == best.reputation && order < best.order);
    }

    /// @dev After this, unpaid (undeclared) payers can be marked in default. Extended past an unpause.
    function _defaultAfter(uint8 r) private view returns (uint256) {
        return _max(rounds[r].paymentDeadline, factory.lastUnpausedAt()) + _params.grace;
    }

    /// @dev Until this, the recipient may reject a declared payment; afterwards it is accepted.
    function _acceptAfter(uint8 r) private view returns (uint256) {
        return _max(rounds[r].paymentDeadline, factory.lastUnpausedAt()) + 2 * uint256(_params.grace);
    }

    function _max(uint64 a, uint64 b) private pure returns (uint256) {
        return a > b ? a : b;
    }

    function _settled(PayStatus s) private pure returns (bool) {
        return s == PayStatus.Attested || s == PayStatus.Confirmed || s == PayStatus.Defaulted;
    }

    function _eligible(address who) private view returns (bool) {
        Member storage m = memberInfo[who];
        return m.exists && !m.hasWon && !m.defaulted;
    }

    function _requirePayer(uint8 r, address payer) private view {
        Round storage rd = rounds[r];
        if (!rd.decided) revert NotDecided();
        if (!memberInfo[payer].exists) revert NotMember();
        if (payer == rd.recipient) revert IsRecipient();
    }
}

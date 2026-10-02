// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Must stay in sync with `CircleType` in packages/shared/src/circle-math.ts.
enum CircleType {
    Fix,
    Float,
    Discount
}

/// @notice Rules of one circle. Amounts are in satang; durations in seconds.
struct CircleParams {
    CircleType circleType;
    /// Round 1 goes to the host without bidding (Float/Discount only).
    bool hostTakesFirst;
    uint8 maxMembers;
    /// Fix only: ± rate ladder across seats, in basis points.
    uint16 fixRateBps;
    uint32 minReputation;
    uint128 principal;
    /// Minimum time between the start of two rounds.
    uint64 period;
    uint64 bidWindow;
    uint64 revealWindow;
    /// Time members have to pay the recipient once the recipient is known.
    uint64 paymentWindow;
    /// Extra time after `paymentWindow` before a payer can be marked in default.
    uint64 grace;
}

/// @notice Statement signed by the backend (ATTESTER_ROLE) that `subject` passed KYC and has
///         `reputation`. `circle` is the circle being joined, or address(0) to create one.
struct Attestation {
    address subject;
    address circle;
    uint32 reputation;
    uint64 deadline;
}

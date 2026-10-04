/**
 * Rules for a peer-share circle (เปียแชร์ / ROSCA), shared by the API, the web app and tests.
 *
 * `packages/contracts/src/Circle.sol` implements exactly the same rules on-chain.
 * Both are checked against `test-vectors/circle-math.json`, so a change here must be
 * mirrored in Solidity (and vice versa) or one of the two test suites fails.
 *
 * All amounts are integers in satang (1 baht = 100 satang) and represented as bigint.
 * Members are identified by their join index: 0 is always the host.
 *
 * Money never flows through the system: in each round every member except the recipient
 * transfers their due directly to the recipient (PromptPay). The UI may show the "gross"
 * pool (net payout + the recipient's own share) as in the Figma designs.
 */

export enum CircleType {
  /**
   * Members pick a seat; seat k receives the pool in round k. Each seat pays a fixed amount
   * every round on a linear ladder from `+fixRateBps` (seat 1) to `-fixRateBps` (last seat),
   * e.g. 5 seats, 1,000 baht, ±10% → 1,100 / 1,050 / 1,000 / 950 / 900 (Figma "Sit in").
   */
  Fix = 0,
  /** ดอกตาม: highest interest bid wins; past winners pay `principal + their winning bid`. */
  Float = 1,
  /** ดอกหัก: highest discount bid wins; members who have not won yet pay `principal - discount`. */
  Discount = 2,
}

export const BPS = 10_000n;

export interface CircleRules {
  type: CircleType;
  /** Contribution per member per round, in satang. */
  principal: bigint;
  /** Number of members (= number of rounds = number of seats). */
  maxMembers: number;
  /** Round 1 goes to the host without bidding (มือนายวง). Float/Discount only. */
  hostTakesFirst: boolean;
  /** Fix only: rate spread in basis points (1000 = ±10%). 0 means everyone pays `principal`. */
  fixRateBps: number;
  /** Policy cap on a bid/discount (see `bidCap`); the principal still caps it too. */
  maxBid?: bigint;
  /** Early rounds (1..⌊N/2⌋) prefer members with at least this reputation (docs/v2/decisions.md D2). */
  trustedReputation?: number;
}

const YEAR_SECONDS = 365n * 24n * 3600n;

/** Annualised policy cap on a bid/discount per round (same as CircleFactory.bidCap). */
export function bidCap(principal: bigint, periodSeconds: number, annualRateBps: number): bigint {
  return (principal * BigInt(annualRateBps) * BigInt(periodSeconds)) / (YEAR_SECONDS * BPS);
}

/** Whether a Fix seat ladder stays within the annualised cap (per-round rate). */
export function fixRateAllowed(fixRateBps: number, periodSeconds: number, annualRateBps: number): boolean {
  return BigInt(fixRateBps) * YEAR_SECONDS <= BigInt(annualRateBps) * BigInt(periodSeconds);
}

/** Rounds that prefer trusted members as recipients. */
export function isEarlyRound(rules: CircleRules, round: number): boolean {
  return round <= Math.floor(rules.maxMembers / 2);
}

export interface Bid {
  member: number;
  amount: bigint;
}

export interface RoundResult {
  round: number;
  recipient: number;
  winningBid: bigint;
  /** Amount each member transfers to the recipient this round; the recipient's own entry is 0. */
  dues: bigint[];
  /** Total the recipient receives from the others. */
  payout: bigint;
}

/** Whether round `round` (1-based) is decided by sealed bids rather than by a fixed rule. */
export function needsBidding(rules: CircleRules, round: number): boolean {
  if (rules.type === CircleType.Fix) return false;
  if (round === 1 && rules.hostTakesFirst) return false;
  return round < rules.maxMembers; // the last unpaid member takes the final round
}

/** Largest bid a member may place (inclusive). */
export function maxBid(rules: CircleRules): bigint {
  const base =
    rules.type === CircleType.Discount ? rules.principal - 1n : rules.type === CircleType.Float ? rules.principal : 0n;
  return rules.maxBid !== undefined && rules.maxBid < base ? rules.maxBid : base;
}

/** Per-round payment of a Fix seat (0-based). Truncates toward zero, like Solidity. */
export function seatPayment(rules: CircleRules, seat: number): bigint {
  const n = BigInt(rules.maxMembers);
  const step = n - 1n - 2n * BigInt(seat); // +(n-1) for the first seat … -(n-1) for the last
  return rules.principal + (rules.principal * BigInt(rules.fixRateBps) * step) / ((n - 1n) * BPS);
}

/**
 * Picks the recipient of a round.
 *
  * Bidding rounds: highest bid wins; ties go to the higher reputation, then to whoever
 * committed first (`bids` must be in commit order). Bids from ineligible members or above
 * `maxBid` are ignored. Otherwise — or without a valid bid — the first eligible member in
 * priority order receives the pool with a bid of 0 (priority = seat order for Fix, join order
 * otherwise). A member is eligible if they have not received the pool yet and are not in
 * default; if nobody is eligible, the first member in priority order who has not received
 * the pool is chosen.
 *
 * Early bidding rounds (decisions D2): while any trusted eligible member remains, only trusted
 * members' bids count and the fallback is the first trusted eligible member.
 */
export function selectRecipient(
  rules: CircleRules,
  round: number,
  priority: readonly number[],
  hasWon: readonly boolean[],
  defaulted: readonly boolean[],
  reputations: readonly number[],
  bids: readonly Bid[],
): { recipient: number; winningBid: bigint } {
  const eligible = (m: number) => !hasWon[m] && !defaulted[m];
  const trusted = (m: number) =>
    rules.trustedReputation === undefined || (reputations[m] ?? 0) >= rules.trustedReputation;
  const trustedOnly =
    needsBidding(rules, round) &&
    rules.trustedReputation !== undefined &&
    isEarlyRound(rules, round) &&
    priority.some((m) => eligible(m) && trusted(m));

  if (needsBidding(rules, round)) {
    let best: Bid | undefined;
    for (const bid of bids) {
      if (!eligible(bid.member) || bid.amount > maxBid(rules)) continue;
      if (trustedOnly && !trusted(bid.member)) continue;
      if (
        best === undefined ||
        bid.amount > best.amount ||
        (bid.amount === best.amount && (reputations[bid.member] ?? 0) > (reputations[best.member] ?? 0))
      ) {
        best = bid;
      }
    }
    if (best) return { recipient: best.member, winningBid: best.amount };
  }

  const first = trustedOnly
    ? priority.find((m) => eligible(m) && trusted(m))
    : (priority.find(eligible) ?? priority.find((m) => !hasWon[m]));
  if (first === undefined) throw new Error("every member has already received the pool");
  return { recipient: first, winningBid: 0n };
}

/**
 * What a payer owes this round's recipient.
 *
 * @param payerSeat the payer's seat (Fix only)
 * @param payerWonBid the bid with which the payer won an earlier round, or null if they have not won yet
 * @param roundWinningBid the winning bid of the current round
 */
export function amountDue(
  rules: CircleRules,
  payerSeat: number,
  payerWonBid: bigint | null,
  roundWinningBid: bigint,
): bigint {
  switch (rules.type) {
    case CircleType.Fix:
      return seatPayment(rules, payerSeat);
    case CircleType.Float:
      return payerWonBid === null ? rules.principal : rules.principal + payerWonBid;
    case CircleType.Discount:
      return payerWonBid === null ? rules.principal - roundWinningBid : rules.principal;
  }
}

/**
 * Plays a whole circle; used for the create-circle preview and as the test oracle.
 *
 * @param seats seat of each member (Fix only); defaults to join order
 */
export function simulateCircle(
  rules: CircleRules,
  reputations: readonly number[],
  bidsPerRound: readonly (readonly Bid[])[],
  seats?: readonly number[],
): RoundResult[] {
  const n = rules.maxMembers;
  const seatOf = seats ?? Array.from({ length: n }, (_, m) => m);
  const priority =
    rules.type === CircleType.Fix
      ? Array.from({ length: n }, (_, m) => m).sort((a, b) => seatOf[a]! - seatOf[b]!)
      : Array.from({ length: n }, (_, m) => m);
  const hasWon = Array<boolean>(n).fill(false);
  const wonBid = Array<bigint | null>(n).fill(null);
  const defaulted = Array<boolean>(n).fill(false);
  const results: RoundResult[] = [];

  for (let round = 1; round <= n; round++) {
    const { recipient, winningBid } = selectRecipient(
      rules, round, priority, hasWon, defaulted, reputations, bidsPerRound[round - 1] ?? [],
    );
    const dues = Array.from({ length: n }, (_, m) =>
      m === recipient ? 0n : amountDue(rules, seatOf[m]!, wonBid[m] ?? null, winningBid),
    );
    results.push({ round, recipient, winningBid, dues, payout: dues.reduce((a, b) => a + b, 0n) });
    hasWon[recipient] = true;
    wonBid[recipient] = winningBid;
  }
  return results;
}

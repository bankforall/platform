import { describe, expect, it } from "vitest";
import data from "../test-vectors/circle-math.json" with { type: "json" };
import {
  CircleType,
  amountDue,
  needsBidding,
  seatPayment,
  selectRecipient,
  simulateCircle,
  type CircleRules,
} from "../src/circle-math.js";
import { createCircleSchema } from "../src/schemas.js";

const DAY = 86400;

describe("simulateCircle matches the shared test vectors", () => {
  for (const v of data.vectors) {
    it(v.name, () => {
      const rules: CircleRules = {
        type: v.type as CircleType,
        principal: BigInt(v.principal),
        maxMembers: v.maxMembers,
        hostTakesFirst: v.hostTakesFirst,
        fixRateBps: v.fixRateBps,
      };
      const bids = v.rounds.map((r) => r.bids.map((b) => ({ member: b.member, amount: BigInt(b.amount) })));
      const results = simulateCircle(rules, v.reputations, bids, v.seats);

      expect(results).toHaveLength(v.rounds.length);
      results.forEach((res, i) => {
        const expected = v.rounds[i]!;
        expect(res.recipient).toBe(expected.recipient);
        expect(res.winningBid).toBe(BigInt(expected.winningBid));
        expect(res.dues).toEqual(expected.dues.map(BigInt));
        expect(res.payout).toBe(BigInt(expected.payout));
      });
      // every member receives the pool exactly once
      expect(new Set(results.map((r) => r.recipient)).size).toBe(v.maxMembers);
    });
  }
});

describe("rules", () => {
  const float: CircleRules = {
    type: CircleType.Float,
    principal: 1000n,
    maxMembers: 4,
    hostTakesFirst: true,
    fixRateBps: 0,
  };
  const joinOrder = [0, 1, 2, 3];

  it("skips bidding for the host round, the last round and Fix circles", () => {
    expect([1, 2, 3, 4].map((r) => needsBidding(float, r))).toEqual([false, true, true, false]);
    expect(needsBidding({ ...float, hostTakesFirst: false }, 1)).toBe(true);
    expect(needsBidding({ ...float, type: CircleType.Fix }, 2)).toBe(false);
  });

  it("ignores bids from past winners, defaulters and over the cap", () => {
    const hasWon = [true, false, false, false];
    const defaulted = [false, false, true, false];
    const pick = selectRecipient(float, 2, joinOrder, hasWon, defaulted, [0, 0, 0, 0], [
      { member: 0, amount: 900n }, // already won
      { member: 2, amount: 800n }, // in default
      { member: 3, amount: 1001n }, // above principal
      { member: 1, amount: 10n },
    ]);
    expect(pick).toEqual({ recipient: 1, winningBid: 10n });
  });

  it("falls back to the first non-winner when every eligible member is in default", () => {
    const pick = selectRecipient(float, 4, joinOrder, [true, true, true, false], [false, false, false, true], [], []);
    expect(pick).toEqual({ recipient: 3, winningBid: 0n });
  });

  it("computes dues per circle type", () => {
    const discount = { ...float, type: CircleType.Discount };
    expect(amountDue(float, 0, null, 50n)).toBe(1000n);
    expect(amountDue(float, 0, 30n, 50n)).toBe(1030n);
    expect(amountDue(discount, 0, null, 50n)).toBe(950n);
    expect(amountDue(discount, 0, 30n, 50n)).toBe(1000n);
  });

  it("builds the Fix seat ladder from the Figma example (5 seats, 1,000 baht, ±10%)", () => {
    const fix = { ...float, type: CircleType.Fix, principal: 100000n, maxMembers: 5, fixRateBps: 1000 };
    expect([0, 1, 2, 3, 4].map((s) => seatPayment(fix, s))).toEqual([110000n, 105000n, 100000n, 95000n, 90000n]);
  });

  it("keeps the Fix ladder balanced for an even number of seats", () => {
    const fix = { ...float, type: CircleType.Fix, principal: 99999n, maxMembers: 6, fixRateBps: 1234 };
    const total = [0, 1, 2, 3, 4, 5].reduce((sum, s) => sum + seatPayment(fix, s), 0n);
    expect(total).toBe(99999n * 6n);
  });
});

describe("createCircleSchema", () => {
  const valid = {
    name: "วงออฟฟิศ",
    type: CircleType.Float,
    principal: "100000",
    maxMembers: 10,
    period: 30 * DAY,
    bidWindow: DAY,
    revealWindow: DAY,
    paymentWindow: 3 * DAY,
    grace: DAY,
  };

  it("accepts a valid circle and applies defaults", () => {
    const parsed = createCircleSchema.parse(valid);
    expect(parsed.principal).toBe(100000n);
    expect(parsed.hostTakesFirst).toBe(true);
    expect(parsed.private).toBe(true);
  });

  it("rejects circles over the legal caps", () => {
    expect(createCircleSchema.safeParse({ ...valid, maxMembers: 31 }).success).toBe(false);
    // 30 members × 10,001 baht > 300,000 baht
    expect(createCircleSchema.safeParse({ ...valid, maxMembers: 30, principal: "1000100" }).success).toBe(false);
  });

  it("rejects windows longer than the period", () => {
    expect(createCircleSchema.safeParse({ ...valid, period: 5 * DAY }).success).toBe(false);
  });
});

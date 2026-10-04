import type { Ctx } from "../context.js";

export const REPUTATION = { perConfirmedPayment: 2, perDefault: 40, perCuredDefault: 10, max: 1000 } as const;

/**
 * Reputation = reviewer-set base + 2 per payment settled on time − 40 per unpaid default
 * − 10 per default that was later paid (a cure gives back 30 of the 40; decisions D5),
 * clamped to 0..1000. Derived from on-chain history only, so it can always be recomputed.
 */
export async function recomputeReputation(ctx: Ctx, userId: string): Promise<number> {
  const user = await ctx.db.user.findUnique({ where: { id: userId } });
  if (!user) return 0;
  const addresses = await userAddresses(ctx, userId, user.walletAddress);
  const [onTime, defaulted, cured] = await Promise.all([
    ctx.db.payment.count({ where: { payer: { in: addresses }, status: "CONFIRMED", wasDefaulted: false } }),
    ctx.db.payment.count({ where: { payer: { in: addresses }, status: "DEFAULTED" } }),
    ctx.db.payment.count({ where: { payer: { in: addresses }, status: "CONFIRMED", wasDefaulted: true } }),
  ]);
  const value = Math.max(
    0,
    Math.min(
      REPUTATION.max,
      user.reputationBase +
        onTime * REPUTATION.perConfirmedPayment -
        defaulted * REPUTATION.perDefault -
        cured * REPUTATION.perCuredDefault,
    ),
  );
  if (value !== user.reputation) await ctx.db.user.update({ where: { id: userId }, data: { reputation: value } });
  return value;
}

/** Every address the user has signed with (memberships keep the address used at the time). */
export async function userAddresses(ctx: Pick<Ctx, "db">, userId: string, current: string | null): Promise<string[]> {
  const rows = await ctx.db.membership.findMany({ where: { userId }, select: { address: true } });
  const set = new Set(rows.map((m) => m.address));
  if (current) set.add(current);
  return [...set];
}

/**
 * Debts from defaults the user still owes (decisions D5): a debt is gone once paid late or set
 * off against what the creditor owed the user, exactly as on-chain (Circle.owed).
 */
export async function outstandingDefaults(ctx: Pick<Ctx, "db">, userId: string, current: string | null) {
  const addresses = await userAddresses(ctx, userId, current);
  return ctx.db.debt.count({ where: { debtor: { in: addresses }, amount: { gt: 0n } } });
}

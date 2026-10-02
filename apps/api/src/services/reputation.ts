import type { Ctx } from "../context.js";

export const REPUTATION = { perConfirmedPayment: 2, perDefault: 40, max: 1000 } as const;

/**
 * Reputation = reviewer-set base + 2 per confirmed payment − 40 per default, clamped to 0..1000.
 * Derived from on-chain history only, so it can always be recomputed.
 */
export async function recomputeReputation(ctx: Ctx, userId: string): Promise<number> {
  const user = await ctx.db.user.findUnique({ where: { id: userId } });
  if (!user) return 0;
  const addresses = (await ctx.db.membership.findMany({ where: { userId }, select: { address: true } })).map(
    (m) => m.address,
  );
  if (user.walletAddress) addresses.push(user.walletAddress);
  const [confirmed, defaulted] = await Promise.all([
    ctx.db.payment.count({ where: { payer: { in: addresses }, status: "CONFIRMED" } }),
    ctx.db.payment.count({ where: { payer: { in: addresses }, status: "DEFAULTED" } }),
  ]);
  const value = Math.max(
    0,
    Math.min(
      REPUTATION.max,
      user.reputationBase + confirmed * REPUTATION.perConfirmedPayment - defaulted * REPUTATION.perDefault,
    ),
  );
  if (value !== user.reputation) await ctx.db.user.update({ where: { id: userId }, data: { reputation: value } });
  return value;
}

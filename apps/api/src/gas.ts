import type { Account } from "viem";
import type { Ctx } from "./context.js";

/** Flags (Redis, read by /api/health) and logs when a gas-paying account runs low. */
export async function checkGas(ctx: Ctx, name: "relayer" | "keeper", account: Account | undefined) {
  if (!account) return;
  const balance = await ctx.chain.publicClient.getBalance({ address: account.address });
  const key = `ops:gas-low:${name}`;
  if (balance < ctx.config.MIN_GAS_BALANCE_WEI) {
    ctx.log.error({ account: account.address, balance: balance.toString() }, `ALERT: ${name} gas balance low — top up`);
    await ctx.redis.set(key, balance.toString(), "PX", 10 * 60_000);
  } else {
    await ctx.redis.del(key);
  }
}

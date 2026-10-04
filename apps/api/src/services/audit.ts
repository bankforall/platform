import type { Ctx } from "../context.js";

/** Append-only record of privileged actions; also written to the log for external retention. */
export async function audit(ctx: Ctx, adminId: string, action: string, targetId: string, detail?: object) {
  await ctx.db.adminAuditLog.create({ data: { adminId, action, targetId, detail } });
  ctx.log.warn({ audit: true, adminId, action, targetId, detail }, `audit: ${action}`);
}

import { Prisma } from "../db.js";
import type { Ctx } from "../context.js";

export interface NotifyInput {
  userId: string;
  kind: string;
  title: string;
  body: string;
  circleId?: string;
  /** Same key → created only once (used for reminders). */
  dedupeKey?: string;
}

/** Stores an in-app notification. Pushing to LINE happens in the worker (`pushPending`). */
export async function notify(ctx: Ctx, input: NotifyInput): Promise<void> {
  try {
    await ctx.db.notification.create({ data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return; // already sent
    throw err;
  }
}

export async function notifyAddress(ctx: Ctx, address: string, input: Omit<NotifyInput, "userId">) {
  const user = await ctx.db.user.findUnique({ where: { walletAddress: address.toLowerCase() } });
  if (user) await notify(ctx, { ...input, userId: user.id });
}

/** Pushes unsent notifications to LINE (if the Messaging API is configured). */
export async function pushPending(ctx: Ctx): Promise<number> {
  if (!ctx.line.messagingEnabled) return 0;
  const pending = await ctx.db.notification.findMany({
    where: { pushedAt: null, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
    include: { user: { select: { lineUserId: true } } },
    take: 50,
    orderBy: { createdAt: "asc" },
  });
  let sent = 0;
  for (const n of pending) {
    if (n.user.lineUserId) {
      const link = n.circleId ? `\n${new URL(`/circles/${n.circleId}`, ctx.config.PUBLIC_URL)}` : "";
      try {
        await ctx.line.push(n.user.lineUserId, `${n.title}\n${n.body}${link}`);
        sent++;
      } catch (err) {
        ctx.log.warn({ err, notification: n.id }, "LINE push failed");
        continue;
      }
    }
    await ctx.db.notification.update({ where: { id: n.id }, data: { pushedAt: new Date() } });
  }
  return sent;
}

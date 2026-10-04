import { userInfo } from "node:os";
import { createDb } from "../db.js";

/**
 * Lost-device recovery for admin passkeys (2FA). Removes every passkey of one admin, signs them out everywhere,
 * and records it in AdminAuditLog. The admin then logs in again and enrols a new passkey within 15 minutes.
 * Verify the person out of band (e.g. video call with ID) before running this.
 * Usage: node dist/cli/clear-admin-passkeys.js <userId|lineUserId> "<reason>"
 */
const [id, ...rest] = process.argv.slice(2);
const reason = rest.join(" ").trim();
if (!id || reason.length < 3) {
  console.error('usage: clear-admin-passkeys <userId | lineUserId> "<reason, e.g. lost phone, verified by video call>"');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const db = createDb(url);
const user = await db.user.findFirst({ where: { OR: [{ id }, { lineUserId: id }] } });
if (!user) {
  console.error(`no user ${id}`);
  process.exit(1);
}
const operator = process.env.SUDO_USER || userInfo().username;
const removed = await db.$transaction(async (tx) => {
  const { count } = await tx.adminPasskey.deleteMany({ where: { userId: user.id } });
  // ends every session (and with it any admin step-up): the next login opens the enrolment window
  await tx.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  await tx.adminAuditLog.create({
    data: {
      adminId: `cli:${operator}`,
      action: "admin.passkeys.cleared",
      targetId: user.id,
      detail: { count, reason, role: user.role },
    },
  });
  return count;
});
console.log(
  `removed ${removed} passkey(s) of ${user.displayName} (${user.id}); they are signed out and must log in again to enrol a new one`,
);
await db.$disconnect();

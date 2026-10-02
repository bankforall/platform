import { createDb } from "../db.js";

/** Grants the ADMIN role (KYC review, key rotation). Usage: node dist/cli/promote-admin.js <userId|lineUserId> */
const id = process.argv[2];
if (!id) {
  console.error("usage: promote-admin <userId | lineUserId>");
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
await db.user.update({ where: { id: user.id }, data: { role: "ADMIN", sessionVersion: { increment: 1 } } });
console.log(`${user.displayName} (${user.id}) is now ADMIN — they must sign in again`);
await db.$disconnect();

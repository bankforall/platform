import type { DeletionRequestView } from "@bankforall/shared";
import type { Ctx } from "../context.js";
import { Prisma, type DeletionRequest, type User } from "../db.js";
import { conflict, notFound } from "../errors.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";
import { outstandingDefaults, userAddresses } from "./reputation.js";

/**
 * PDPA data-subject rights: data export and account deletion.
 *
 * On-chain records (addresses, payment states, slip hashes) are immutable and are the evidence the
 * other members of a circle rely on, so deletion never touches them. It anonymises the account:
 * personal data held off-chain is deleted or replaced with tombstones, and the remaining rows only
 * link a pseudonymous address to "a deleted user". See docs/legal/privacy-th.md.
 */

export const DELETED_NAME = "ผู้ใช้ที่ลบบัญชีแล้ว";
/** Actor id written to the audit log for actions taken by the worker. */
export const SYSTEM_ACTOR = "system";

export interface DeletionFacts {
  /** Circles the user is a member of that started and have not finished. */
  activeCircles: number;
  /** Circles the user joined (or hosts) that are still open for members and may start. */
  openCircles: number;
  /** Unpaid defaults (decisions D5): other members are owed money by this user. */
  outstandingDefaults: number;
  /** Key recovery in progress. */
  pendingRotation: boolean;
}

/** Thai explanations of why an account cannot be deleted now; empty = it can. */
export function deletionBlockers(f: DeletionFacts): string[] {
  const reasons: string[] = [];
  if (f.activeCircles > 0) {
    reasons.push(
      `คุณยังเป็นสมาชิกของวงแชร์ที่กำลังดำเนินอยู่ ${f.activeCircles} วง สมาชิกคนอื่นต้องใช้ข้อมูลของคุณในการรับ-ส่งเงินและเป็นหลักฐาน จึงลบบัญชีได้หลังวงจบแล้ว`,
    );
  }
  if (f.openCircles > 0) {
    reasons.push(`คุณอยู่ในวงที่ยังเปิดรับสมาชิก ${f.openCircles} วง ซึ่งอาจเริ่มได้ทุกเมื่อ ให้ยกเลิกวงหรือรอให้วงจบก่อน`);
  }
  if (f.outstandingDefaults > 0) {
    reasons.push(
      `คุณมีหนี้ผิดนัดค้างอยู่ ${f.outstandingDefaults} รายการ สมาชิกที่ยังไม่ได้รับเงินต้องใช้ข้อมูลของคุณในการติดตามหนี้ ชำระย้อนหลังให้ครบก่อนจึงจะลบบัญชีได้`,
    );
  }
  if (f.pendingRotation) reasons.push("มีคำขอเปลี่ยนกุญแจที่ยังดำเนินการอยู่ ให้รอให้เสร็จหรือยกเลิกก่อน");
  return reasons;
}

export async function deletionFacts(ctx: Pick<Ctx, "db">, user: User): Promise<DeletionFacts> {
  const addresses = await userAddresses(ctx, user.id, user.walletAddress);
  const mine = { OR: [{ userId: user.id }, ...(addresses.length ? [{ address: { in: addresses } }] : [])] };
  const [activeCircles, openCircles, defaults, rotations] = await Promise.all([
    ctx.db.membership.count({ where: { ...mine, circle: { status: "ACTIVE" } } }),
    ctx.db.membership.count({ where: { ...mine, circle: { status: "OPEN" } } }),
    outstandingDefaults(ctx, user.id, user.walletAddress),
    ctx.db.keyRotationRequest.count({ where: { userId: user.id, status: { in: ["PENDING", "APPROVED"] } } }),
  ]);
  return { activeCircles, openCircles, outstandingDefaults: defaults, pendingRotation: rotations > 0 };
}

export function deletionView(d: DeletionRequest): DeletionRequestView {
  return {
    id: d.id,
    status: d.status,
    executeAfter: d.executeAfter.toISOString(),
    reason: d.reason,
    createdAt: d.createdAt.toISOString(),
  };
}

export async function requestDeletion(ctx: Ctx, user: User): Promise<DeletionRequest> {
  const open = await ctx.db.deletionRequest.findFirst({ where: { userId: user.id, status: "PENDING" } });
  if (open) throw conflict("มีคำขอลบบัญชีที่รอดำเนินการอยู่แล้ว", "DELETION_PENDING");
  const blockers = deletionBlockers(await deletionFacts(ctx, user));
  if (blockers.length) throw conflict(blockers.join(" "), "DELETION_BLOCKED");
  const days = ctx.config.ACCOUNT_DELETION_DELAY_DAYS;
  const request = await ctx.db.deletionRequest.create({
    data: { userId: user.id, executeAfter: new Date(Date.now() + days * 86400_000) },
  });
  await audit(ctx, user.id, "account.deletion.request", user.id, { requestId: request.id });
  await notify(ctx, {
    userId: user.id,
    kind: "security",
    title: "ได้รับคำขอลบบัญชีแล้ว",
    body: `บัญชีจะถูกลบหลัง ${request.executeAfter.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} หากคุณไม่ได้ขอ ให้ยกเลิกในหน้าโปรไฟล์ทันที`,
  });
  return request;
}

export async function cancelDeletion(ctx: Ctx, user: User): Promise<void> {
  const res = await ctx.db.deletionRequest.updateMany({
    where: { userId: user.id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (res.count === 0) throw notFound("ไม่มีคำขอลบบัญชีที่ยกเลิกได้");
  await audit(ctx, user.id, "account.deletion.cancel", user.id);
}

/**
 * Anonymises an account. Deleted: KYC images (storage), real name, national-ID HMAC and last
 * digits, phone, LINE id, profile picture, PromptPay, key backup, OTPs and notifications; open key
 * rotations are cancelled and every session is revoked. Kept: the user row as a tombstone with its
 * wallet address, memberships, payments, chain events, intents, disputes, slips (until
 * DELETED_SLIP_RETENTION_DAYS after the circle ended, see purgeExpiredSlips) and the audit log.
 */
export async function anonymiseUser(ctx: Pick<Ctx, "db" | "storage" | "enc">, userId: string): Promise<void> {
  const kycs = await ctx.db.kycSubmission.findMany({ where: { userId, purgedAt: null } });
  // files first: if this fails the request stays PENDING and the worker retries
  for (const k of kycs) {
    await ctx.storage.delete(k.idCardKey);
    await ctx.storage.delete(k.selfieKey);
  }
  const now = new Date();
  await ctx.db.$transaction([
    ctx.db.kycSubmission.updateMany({
      where: { userId },
      data: {
        fullNameEnc: ctx.enc.encryptString(DELETED_NAME),
        nationalIdHash: `deleted:${userId}`,
        nationalIdLast4: "",
        idCardKey: "",
        selfieKey: "",
        purgedAt: now,
      },
    }),
    ctx.db.otpChallenge.deleteMany({ where: { userId } }),
    ctx.db.notification.deleteMany({ where: { userId } }),
    ctx.db.keyRotationRequest.updateMany({
      where: { userId, status: { in: ["PENDING", "APPROVED"] } },
      data: { status: "CANCELLED", reason: "ลบบัญชี" },
    }),
    ctx.db.user.update({
      where: { id: userId },
      data: {
        displayName: DELETED_NAME,
        pictureUrl: null,
        lineUserId: null,
        phone: null,
        phoneVerifiedAt: null,
        promptPayId: null,
        walletBackup: Prisma.DbNull,
        role: "USER",
        deletedAt: now,
        sessionVersion: { increment: 1 },
      },
    }),
  ]);
}

/** Worker job: executes deletion requests whose cooling-off period has passed. */
export async function executeDueDeletions(ctx: Ctx): Promise<number> {
  const due = await ctx.db.deletionRequest.findMany({
    where: { status: "PENDING", executeAfter: { lte: new Date() } },
    include: { user: true },
    orderBy: { executeAfter: "asc" },
    take: 10,
  });
  let done = 0;
  for (const req of due) {
    // the user may have joined a circle or defaulted during the cooling-off period
    const blockers = deletionBlockers(await deletionFacts(ctx, req.user));
    if (blockers.length) {
      const reason = blockers.join(" ");
      await ctx.db.deletionRequest.update({ where: { id: req.id }, data: { status: "REFUSED", reason } });
      await audit(ctx, SYSTEM_ACTOR, "account.deletion.refuse", req.userId, { requestId: req.id, reason });
      await notify(ctx, { userId: req.userId, kind: "security", title: "ลบบัญชีไม่ได้ในตอนนี้", body: reason });
      continue;
    }
    try {
      await anonymiseUser(ctx, req.userId);
    } catch (err) {
      ctx.log.error({ err, requestId: req.id }, "account deletion failed; will retry");
      continue;
    }
    await ctx.db.deletionRequest.update({ where: { id: req.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await audit(ctx, SYSTEM_ACTOR, "account.deletion.complete", req.userId, { requestId: req.id });
    done++;
  }
  return done;
}

/**
 * Worker job: deletes slip images of deleted accounts once the retention period after the circle
 * ended has passed. The slip hash stays (it is on-chain anyway).
 */
export async function purgeExpiredSlips(ctx: Ctx): Promise<number> {
  const cutoff = new Date(Date.now() - ctx.config.DELETED_SLIP_RETENTION_DAYS * 86400_000);
  const slips = await ctx.db.slip.findMany({
    where: {
      purgedAt: null,
      user: { deletedAt: { not: null } },
      circle: { status: { in: ["COMPLETED", "CANCELLED", "FAILED"] }, updatedAt: { lt: cutoff } },
    },
    take: 50,
  });
  for (const s of slips) {
    await ctx.storage.delete(s.storageKey);
    await ctx.db.slip.update({ where: { id: s.id }, data: { storageKey: "", purgedAt: new Date() } });
  }
  return slips.length;
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/**
 * Everything the service holds about the user (PDPA right of access / portability), as JSON.
 * The national ID is not included: only a keyed hash and the last 4 digits are stored.
 */
export async function exportUserData(ctx: Ctx, user: User) {
  const addresses = await userAddresses(ctx, user.id, user.walletAddress);
  const [kycs, memberships, payments, slips, notifications, intents, disputes, rotations, deletions] = await Promise.all([
    ctx.db.kycSubmission.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    ctx.db.membership.findMany({
      where: { OR: [{ userId: user.id }, { address: { in: addresses } }] },
      include: { circle: { select: { id: true, name: true, address: true, status: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    ctx.db.payment.findMany({ where: { payer: { in: addresses } }, orderBy: [{ circleId: "asc" }, { round: "asc" }] }),
    ctx.db.slip.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    ctx.db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    ctx.db.txIntent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    ctx.db.dispute.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    ctx.db.keyRotationRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    ctx.db.deletionRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const targets = [user.id, ...kycs.map((k) => k.id), ...rotations.map((r) => r.id)];
  const auditEntries = await ctx.db.adminAuditLog.findMany({
    where: { targetId: { in: targets } },
    orderBy: { createdAt: "asc" },
  });
  const url = (path: string) => new URL(path, ctx.config.PUBLIC_URL).toString();

  return {
    format: "bankforall.personal-data-export/1",
    service: ctx.config.APP_NAME,
    generatedAt: new Date().toISOString(),
    note:
      "ข้อมูลส่วนบุคคลทั้งหมดที่ระบบเก็บเกี่ยวกับคุณ เลขประจำตัวประชาชนไม่ได้ถูกเก็บ (เก็บเฉพาะค่า hash และ 4 หลักท้าย) " +
      "ลิงก์ไฟล์เปิดได้เมื่อเข้าสู่ระบบอยู่เท่านั้น รายการบนเครือข่ายสาธารณะตรวจสอบได้จาก txHash",
    profile: {
      id: user.id,
      displayName: user.displayName,
      pictureUrl: user.pictureUrl,
      lineUserId: user.lineUserId,
      role: user.role,
      phone: user.phone,
      phoneVerifiedAt: iso(user.phoneVerifiedAt),
      promptPayId: user.promptPayId,
      consentVersion: user.consentVersion,
      consentAt: iso(user.consentAt),
      walletAddress: user.walletAddress,
      hasWalletBackup: Boolean(user.walletBackup),
      kycStatus: user.kycStatus,
      reputation: user.reputation,
      reputationBase: user.reputationBase,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
    kycSubmissions: kycs.map((k) => ({
      id: k.id,
      fullName: k.purgedAt ? null : ctx.enc.decryptString(k.fullNameEnc),
      nationalIdLast4: k.nationalIdLast4,
      status: k.status,
      reason: k.reason,
      createdAt: k.createdAt.toISOString(),
      reviewedAt: iso(k.reviewedAt),
      files: k.purgedAt
        ? []
        : [
            { kind: "idCard", description: "รูปบัตรประชาชน (เข้ารหัสในระบบจัดเก็บ)", url: url(`/api/me/kyc/${k.id}/idCard`) },
            { kind: "selfie", description: "รูปถ่ายคู่บัตร (เข้ารหัสในระบบจัดเก็บ)", url: url(`/api/me/kyc/${k.id}/selfie`) },
          ],
    })),
    memberships: memberships.map((m) => ({
      circleId: m.circleId,
      circleName: m.circle.name,
      circleAddress: m.circle.address,
      circleStatus: m.circle.status,
      address: m.address,
      seat: m.seat,
      hasWon: m.hasWon,
      wonRound: m.wonRound,
      wonBid: m.wonBid.toString(),
      defaulted: m.defaulted,
      joinedAt: m.joinedAt.toISOString(),
    })),
    payments: payments.map((p) => ({
      circleId: p.circleId,
      round: p.round,
      payer: p.payer,
      amountSatang: p.amount?.toString() ?? null,
      offsetSatang: p.offset.toString(),
      status: p.status,
      wasDefaulted: p.wasDefaulted,
      slipHash: p.slipHash,
      txHash: p.txHash,
      updatedAt: p.updatedAt.toISOString(),
    })),
    slips: slips.map((s) => ({
      id: s.id,
      circleId: s.circleId,
      round: s.round,
      sha256: s.sha256,
      verify: s.verify,
      createdAt: s.createdAt.toISOString(),
      url: s.purgedAt ? null : url(`/api/slips/${s.id}`),
      purgedAt: iso(s.purgedAt),
    })),
    notifications: notifications.map((n) => ({
      kind: n.kind,
      title: n.title,
      body: n.body,
      circleId: n.circleId,
      createdAt: n.createdAt.toISOString(),
      readAt: iso(n.readAt),
    })),
    transactions: intents.map((i) => ({
      id: i.id,
      kind: i.kind,
      circleId: i.circleId,
      status: i.status,
      txHash: i.txHash,
      createdAt: i.createdAt.toISOString(),
    })),
    disputes: disputes.map((d) => ({
      circleId: d.circleId,
      round: d.round,
      reason: d.reason,
      reasonHash: d.reasonHash,
      txHash: d.txHash,
      createdAt: d.createdAt.toISOString(),
    })),
    keyRotations: rotations.map((r) => ({
      id: r.id,
      oldAddress: r.oldAddress,
      newAddress: r.newAddress,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      executedAt: iso(r.executedAt),
    })),
    deletionRequests: deletions.map(deletionView),
    auditLog: auditEntries.map((a) => ({
      action: a.action,
      targetId: a.targetId,
      byStaff: a.adminId !== user.id && a.adminId !== SYSTEM_ACTOR,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function listDeletionRequests(ctx: Ctx, status: DeletionRequest["status"]) {
  const items = await ctx.db.deletionRequest.findMany({
    where: { status },
    include: { user: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return items.map((d) => ({
    ...deletionView(d),
    userId: d.userId,
    displayName: d.user.displayName,
    completedAt: iso(d.completedAt),
  }));
}

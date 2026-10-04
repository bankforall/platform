import { circleAbi, keyRotationMessage, type KeyRotationView } from "@bankforall/shared";
import { encodeFunctionData, getAddress, verifyMessage, type Address, type Hex } from "viem";
import { need } from "../chain/clients.js";
import type { Ctx } from "../context.js";
import { Prisma, type KeyRotationRequest, type User } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { audit } from "./audit.js";
import { ingestLogs } from "./ingest.js";
import { notify } from "./notify.js";

type Approval = { adminId: string; at: string };

/**
 * Account recovery when the device and the recovery code are both lost:
 *   1. the user (logged in with LINE) creates a new key on a new device and signs a request with it;
 *   2. two different admins approve after re-verifying the person;
 *   3. after KEY_ROTATION_DELAY_HOURS (the user is notified and can cancel) the worker switches the
 *      key on-chain in every open/active circle via the signer service.
 */
export async function requestRotation(ctx: Ctx, user: User, newAddress: Address, proof: Hex) {
  if (!user.walletAddress) throw badRequest("บัญชียังไม่มีกุญแจ ไม่ต้องขอเปลี่ยน", "NO_WALLET");
  if (user.kycStatus !== "APPROVED") throw forbidden("ต้องยืนยันตัวตนก่อนจึงจะขอเปลี่ยนกุญแจได้");
  const next = newAddress.toLowerCase();
  if (next === user.walletAddress) throw badRequest("เป็นกุญแจเดิม", "SAME_KEY");
  const ok = await verifyMessage({ address: getAddress(next), message: keyRotationMessage(user.id, next), signature: proof }).catch(
    () => false,
  );
  if (!ok) throw badRequest("ลายเซ็นของกุญแจใหม่ไม่ถูกต้อง", "BAD_PROOF");
  if (await ctx.db.user.findUnique({ where: { walletAddress: next } })) throw conflict("กุญแจนี้ถูกใช้แล้ว", "WALLET_TAKEN");
  const open = await ctx.db.keyRotationRequest.findFirst({
    where: { userId: user.id, status: { in: ["PENDING", "APPROVED"] } },
  });
  if (open) throw conflict("มีคำขอเปลี่ยนกุญแจที่ยังดำเนินการอยู่", "ROTATION_PENDING");
  const req = await ctx.db.keyRotationRequest.create({
    data: { userId: user.id, oldAddress: user.walletAddress, newAddress: next, proof },
  });
  await notify(ctx, {
    userId: user.id,
    kind: "security",
    title: "มีการขอเปลี่ยนกุญแจของบัญชีคุณ",
    body: "หากคุณไม่ได้ทำรายการนี้ ให้กดยกเลิกในหน้าโปรไฟล์ทันที และติดต่อเจ้าหน้าที่",
  });
  ctx.log.warn({ userId: user.id, requestId: req.id }, "key rotation requested");
  return req;
}

export async function cancelRotation(ctx: Ctx, user: User) {
  const res = await ctx.db.keyRotationRequest.updateMany({
    where: { userId: user.id, status: { in: ["PENDING", "APPROVED"] } },
    data: { status: "CANCELLED", reason: "cancelled by user" },
  });
  if (res.count === 0) throw notFound("ไม่มีคำขอเปลี่ยนกุญแจ");
  ctx.log.warn({ userId: user.id }, "key rotation cancelled by user");
}

export function pendingRotationView(r: KeyRotationRequest | null) {
  if (!r) return null;
  return {
    id: r.id,
    newAddress: r.newAddress,
    approvals: (r.approvals as Approval[]).length,
    executeAfter: r.executeAfter ? Math.floor(r.executeAfter.getTime() / 1000) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function view(ctx: Ctx, r: KeyRotationRequest & { user: User }): Promise<KeyRotationView> {
  const approvals = r.approvals as Approval[];
  const admins = await ctx.db.user.findMany({
    where: { id: { in: approvals.map((a) => a.adminId) } },
    select: { id: true, displayName: true },
  });
  return {
    id: r.id,
    userId: r.userId,
    displayName: r.user.displayName,
    oldAddress: r.oldAddress,
    newAddress: r.newAddress,
    status: r.status,
    approvals: approvals.map((a) => ({
      adminId: a.adminId,
      adminName: admins.find((x) => x.id === a.adminId)?.displayName ?? a.adminId,
      at: a.at,
    })),
    executeAfter: r.executeAfter?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listRotations(ctx: Ctx, status: "PENDING" | "APPROVED" | "EXECUTED" | "CANCELLED" | "FAILED") {
  const items = await ctx.db.keyRotationRequest.findMany({
    where: { status },
    include: { user: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return Promise.all(items.map((r) => view(ctx, r)));
}

export async function approveRotation(ctx: Ctx, admin: User, id: string): Promise<KeyRotationView> {
  return ctx.db.$transaction(
    async (tx) => {
      const r = await tx.keyRotationRequest.findUnique({ where: { id }, include: { user: true } });
      if (!r) throw notFound();
      if (r.status !== "PENDING") throw conflict("คำขอนี้ไม่อยู่ในสถานะรออนุมัติ");
      if (r.userId === admin.id) throw forbidden("อนุมัติคำขอของตัวเองไม่ได้");
      if (r.user.kycStatus !== "APPROVED") throw forbidden("ผู้ขอต้องยืนยันตัวตนแล้ว");
      const approvals = r.approvals as Approval[];
      if (approvals.some((a) => a.adminId === admin.id)) throw conflict("คุณอนุมัติคำขอนี้แล้ว ต้องให้ผู้ดูแลอีกคนอนุมัติ");
      const next = [...approvals, { adminId: admin.id, at: new Date().toISOString() }];
      const approved = next.length >= 2;
      const executeAfter = approved ? new Date(Date.now() + ctx.config.KEY_ROTATION_DELAY_HOURS * 3600_000) : null;
      const updated = await tx.keyRotationRequest.update({
        where: { id },
        data: { approvals: next, ...(approved ? { status: "APPROVED", executeAfter } : {}) },
        include: { user: true },
      });
      await tx.adminAuditLog.create({
        data: { adminId: admin.id, action: "rotation.approve", targetId: id, detail: { approvals: next.length } },
      });
      if (approved) {
        await tx.notification.create({
          data: {
            userId: r.userId,
            kind: "security",
            title: "คำขอเปลี่ยนกุญแจได้รับอนุมัติแล้ว",
            body: `ระบบจะเปลี่ยนกุญแจหลัง ${executeAfter!.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} หากคุณไม่ได้ขอ ให้กดยกเลิกทันที`,
          },
        });
      }
      return view(ctx, updated);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function rejectRotation(ctx: Ctx, admin: User, id: string, reason: string) {
  const res = await ctx.db.keyRotationRequest.updateMany({
    where: { id, status: { in: ["PENDING", "APPROVED"] } },
    data: { status: "CANCELLED", reason },
  });
  if (res.count === 0) throw notFound();
  await audit(ctx, admin.id, "rotation.reject", id, { reason });
}

/** Worker: executes approved rotations whose waiting time has passed. */
export async function executeDueRotations(ctx: Ctx): Promise<void> {
  const due = await ctx.db.keyRotationRequest.findMany({
    where: { status: "APPROVED", executeAfter: { lte: new Date() } },
    take: 5,
  });
  for (const r of due) {
    try {
      const keeper = need(ctx.chain.keeper, "keeper key");
      const sigs = await ctx.signer.rotationSignatures(r.id);
      // the account switches first so ingested MemberRotated events link memberships to this user
      await ctx.db.user.update({
        where: { id: r.userId },
        data: { walletAddress: r.newAddress, walletBackup: Prisma.DbNull, sessionVersion: { increment: 1 } },
      });
      for (const s of sigs) {
        const hash = await ctx.chain.sender.send(keeper, {
          to: s.circle,
          data: encodeFunctionData({
            abi: circleAbi,
            functionName: "rotateMember",
            args: [getAddress(r.oldAddress), getAddress(r.newAddress), s.deadline, s.signature],
          }),
        });
        const receipt = await ctx.chain.sender.wait(hash);
        if (receipt.status !== "success") throw new Error(`rotateMember reverted in ${s.circle} (${hash})`);
        await ingestLogs(ctx, receipt.logs);
      }
      // sealed bids of the old key were discarded on-chain; drop their stored secrets too
      await ctx.db.bidSecret.deleteMany({ where: { member: r.oldAddress, revealed: false } });
      await ctx.db.keyRotationRequest.update({ where: { id: r.id }, data: { status: "EXECUTED", executedAt: new Date() } });
      await notify(ctx, {
        userId: r.userId,
        kind: "security",
        title: "เปลี่ยนกุญแจของบัญชีเรียบร้อย ✓",
        body: "กรุณาเข้าสู่ระบบอีกครั้งบนเครื่องใหม่ และเก็บรหัสกู้คืนชุดใหม่ไว้ให้ดี",
      });
      ctx.log.warn({ requestId: r.id, circles: sigs.length }, "key rotation executed");
    } catch (err) {
      ctx.log.error({ err, requestId: r.id }, "ALERT: key rotation failed");
      await ctx.db.keyRotationRequest.update({
        where: { id: r.id },
        data: { status: "FAILED", reason: String((err as Error).message).slice(0, 500) },
      });
    }
  }
}

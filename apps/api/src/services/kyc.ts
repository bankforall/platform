import { Prisma, type User } from "@prisma/client";
import { circleAbi } from "@bankforall/shared";
import { encodeFunctionData, getAddress, type Address } from "viem";
import { signKeyRotation } from "../chain/signing.js";
import type { Ctx } from "../context.js";
import { hmac } from "../crypto.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { ingestLogs } from "./ingest.js";
import { notify } from "./notify.js";
import { recomputeReputation } from "./reputation.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

export interface Upload {
  data: Buffer;
  contentType: string;
}

export function checkImage(file: Upload | undefined, label: string): Upload {
  if (!file) throw badRequest(`กรุณาแนบ${label}`);
  if (!IMAGE_TYPES.has(file.contentType)) throw badRequest(`${label}ต้องเป็นไฟล์รูปภาพ`);
  if (file.data.length > MAX_IMAGE_BYTES) throw badRequest(`${label}มีขนาดเกิน 8MB`);
  return file;
}

/** Thai national ID checksum (mod 11). */
export function validNationalId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

export async function submitKyc(
  ctx: Ctx,
  user: User,
  input: { fullName: string; nationalId: string; idCard: Upload; selfie: Upload },
) {
  if (user.kycStatus === "APPROVED") throw conflict("ยืนยันตัวตนเรียบร้อยแล้ว", "KYC_DONE");
  if (user.kycStatus === "PENDING") throw conflict("กำลังตรวจสอบข้อมูลของคุณ", "KYC_PENDING");
  if (!validNationalId(input.nationalId)) throw badRequest("เลขประจำตัวประชาชนไม่ถูกต้อง");
  const nationalIdHash = hmac(ctx.config.HMAC_KEY, `nid:${input.nationalId}`);
  const other = await ctx.db.kycSubmission.findFirst({
    where: { nationalIdHash, status: "APPROVED", userId: { not: user.id } },
  });
  if (other) throw conflict("เลขประจำตัวนี้ยืนยันตัวตนกับบัญชีอื่นแล้ว หนึ่งคนใช้ได้หนึ่งบัญชี", "KYC_DUPLICATE");

  const [idCardKey, selfieKey] = await Promise.all([
    ctx.storage.put(`kyc/${user.id}`, input.idCard.data),
    ctx.storage.put(`kyc/${user.id}`, input.selfie.data),
  ]);
  await ctx.db.$transaction([
    ctx.db.kycSubmission.create({
      data: {
        userId: user.id,
        fullNameEnc: ctx.enc.encryptString(input.fullName),
        nationalIdHash,
        nationalIdLast4: input.nationalId.slice(-4),
        idCardKey,
        selfieKey,
      },
    }),
    ctx.db.user.update({ where: { id: user.id }, data: { kycStatus: "PENDING" } }),
  ]);
}

export async function listKyc(ctx: Ctx, status: "PENDING" | "APPROVED" | "REJECTED") {
  const items = await ctx.db.kycSubmission.findMany({
    where: { status },
    include: { user: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return items.map((k) => ({
    id: k.id,
    userId: k.userId,
    displayName: k.user.displayName,
    fullName: ctx.enc.decryptString(k.fullNameEnc),
    nationalIdLast4: k.nationalIdLast4,
    status: k.status,
    createdAt: k.createdAt.toISOString(),
  }));
}

export async function kycFile(ctx: Ctx, id: string, which: "idCard" | "selfie") {
  const k = await ctx.db.kycSubmission.findUnique({ where: { id } });
  if (!k) throw notFound();
  return ctx.storage.get(which === "idCard" ? k.idCardKey : k.selfieKey);
}

export async function decideKyc(
  ctx: Ctx,
  reviewer: User,
  id: string,
  decision: { approve: boolean; reason?: string; reputation?: number },
) {
  const k = await ctx.db.kycSubmission.findUnique({ where: { id } });
  if (!k) throw notFound();
  if (k.status !== "PENDING") throw conflict("รายการนี้ถูกตัดสินแล้ว");
  if (decision.approve) {
    const dup = await ctx.db.kycSubmission.findFirst({
      where: { nationalIdHash: k.nationalIdHash, status: "APPROVED", userId: { not: k.userId } },
    });
    if (dup) throw conflict("เลขประจำตัวนี้ยืนยันกับบัญชีอื่นแล้ว");
  } else if (!decision.reason) {
    throw badRequest("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
  }
  const status = decision.approve ? "APPROVED" : "REJECTED";
  await ctx.db.$transaction([
    ctx.db.kycSubmission.update({
      where: { id },
      data: { status, reason: decision.reason, reviewerId: reviewer.id, reviewedAt: new Date() },
    }),
    ctx.db.user.update({
      where: { id: k.userId },
      data: { kycStatus: status, ...(decision.reputation !== undefined ? { reputationBase: decision.reputation } : {}) },
    }),
  ]);
  await recomputeReputation(ctx, k.userId);
  await notify(ctx, {
    userId: k.userId,
    kind: "kyc",
    title: decision.approve ? "ยืนยันตัวตนสำเร็จ ✓" : "ยืนยันตัวตนไม่ผ่าน",
    body: decision.approve ? "คุณสร้างหรือเข้าร่วมวงแชร์ได้แล้ว" : `เหตุผล: ${decision.reason}`,
  });
}

/**
 * Account recovery after the user lost both their device and recovery code: once staff have
 * re-verified the person, the attester approves replacing their key in every open/active circle.
 */
export async function rotateUserKey(ctx: Ctx, userId: string, newAddress: Address) {
  const user = await ctx.db.user.findUnique({ where: { id: userId } });
  if (!user?.walletAddress) throw notFound("ผู้ใช้ยังไม่มีกุญแจ");
  const next = newAddress.toLowerCase();
  if (await ctx.db.user.findUnique({ where: { walletAddress: next } })) throw conflict("ที่อยู่นี้ถูกใช้แล้ว");
  const old = getAddress(user.walletAddress);
  const memberships = await ctx.db.membership.findMany({
    where: { address: user.walletAddress, circle: { status: { in: ["OPEN", "ACTIVE"] } } },
    include: { circle: true },
  });
  // register the new key first so ingested MemberRotated events link memberships to this user
  await ctx.db.user.update({ where: { id: userId }, data: { walletAddress: next, walletBackup: Prisma.DbNull, sessionVersion: { increment: 1 } } });
  const rotated: string[] = [];
  for (const m of memberships) {
    const circle = getAddress(m.circle.address!);
    const { deadline, signature } = await signKeyRotation(ctx.chain, circle, old, getAddress(next));
    const hash = await ctx.chain.sender.send(ctx.chain.keeper, {
      to: circle,
      data: encodeFunctionData({
        abi: circleAbi,
        functionName: "rotateMember",
        args: [old, getAddress(next), deadline, signature],
      }),
    });
    const receipt = await ctx.chain.sender.wait(hash);
    if (receipt.status === "success") {
      await ingestLogs(ctx, receipt.logs);
      rotated.push(m.circleId);
    } else {
      ctx.log.error({ circle: m.circleId, hash }, "rotateMember failed");
    }
  }
  return { rotated, total: memberships.length };
}

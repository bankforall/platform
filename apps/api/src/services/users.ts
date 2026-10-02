import type { User } from "@prisma/client";
import type { MeResponse } from "@bankforall/shared";
import { CONSENT_VERSION } from "@bankforall/shared";
import type { Ctx } from "../context.js";
import { hmac, randomDigits, safeEqual } from "../crypto.js";
import { badRequest, conflict, AppError } from "../errors.js";

type Step = MeResponse["onboarding"][number];

export function onboardingSteps(u: User): Step[] {
  const steps: Step[] = [];
  if (!u.phoneVerifiedAt) steps.push("phone");
  if (!u.promptPayId) steps.push("promptpay");
  if (u.consentVersion !== CONSENT_VERSION) steps.push("consent");
  if (!u.walletAddress) steps.push("wallet");
  if (u.kycStatus !== "APPROVED") steps.push("kyc");
  return steps;
}

export async function meView(ctx: Ctx, u: User): Promise<MeResponse> {
  const lastKyc = await ctx.db.kycSubmission.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" } });
  return {
    id: u.id,
    displayName: u.displayName,
    pictureUrl: u.pictureUrl,
    role: u.role,
    phone: u.phone,
    phoneVerified: Boolean(u.phoneVerifiedAt),
    promptPayId: u.promptPayId,
    consentVersion: u.consentVersion,
    walletAddress: u.walletAddress,
    hasWalletBackup: Boolean(u.walletBackup),
    kycStatus: u.kycStatus,
    kycReason: lastKyc?.status === "REJECTED" ? (lastKyc.reason ?? null) : null,
    reputation: u.reputation,
    onboarding: onboardingSteps(u),
  };
}

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_PER_HOUR = 5;

/** Returns the code only in development with the console SMS provider (for local testing). */
export async function sendOtp(ctx: Ctx, user: User, phone: string): Promise<string | undefined> {
  const owner = await ctx.db.user.findUnique({ where: { phone } });
  if (owner && owner.id !== user.id && owner.phoneVerifiedAt) throw conflict("เบอร์นี้ถูกใช้กับบัญชีอื่นแล้ว", "PHONE_TAKEN");
  const recent = await ctx.db.otpChallenge.count({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 3600_000) } },
  });
  if (recent >= OTP_PER_HOUR) throw new AppError(429, "OTP_RATE", "ขอรหัสบ่อยเกินไป กรุณารอสักครู่");
  const code = randomDigits(6);
  await ctx.db.otpChallenge.create({
    data: {
      userId: user.id,
      phone,
      codeHash: hmac(ctx.config.HMAC_KEY, `otp:${user.id}:${code}`),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  await ctx.sms.send(phone, `รหัสยืนยัน Bank For All: ${code} (หมดอายุใน 5 นาที) ห้ามบอกรหัสนี้กับผู้อื่น`);
  return ctx.config.NODE_ENV !== "production" && ctx.config.SMS_PROVIDER === "console" ? code : undefined;
}

export async function verifyOtp(ctx: Ctx, user: User, code: string) {
  const challenge = await ctx.db.otpChallenge.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) throw badRequest("รหัสหมดอายุ กรุณาขอรหัสใหม่", "OTP_EXPIRED");
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw badRequest("ใส่รหัสผิดเกินจำนวนครั้ง กรุณาขอรหัสใหม่", "OTP_LOCKED");
  const ok = safeEqual(challenge.codeHash, hmac(ctx.config.HMAC_KEY, `otp:${user.id}:${code}`));
  if (!ok) {
    await ctx.db.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    throw badRequest("รหัสไม่ถูกต้อง", "OTP_INVALID");
  }
  await ctx.db.$transaction([
    ctx.db.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } }),
    ctx.db.user.updateMany({ where: { phone: challenge.phone, id: { not: user.id }, phoneVerifiedAt: null }, data: { phone: null } }),
    ctx.db.user.update({ where: { id: user.id }, data: { phone: challenge.phone, phoneVerifiedAt: new Date() } }),
  ]);
}

/** Masks a PromptPay ID for display: 081-xxx-5678. */
export function maskPromptPay(id: string): string {
  return id.length <= 4 ? id : `${id.slice(0, 3)}${"x".repeat(id.length - 7)}${id.slice(-4)}`;
}

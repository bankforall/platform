import type { OtpPurpose, User } from "../db.js";
import { pendingRotationView } from "./rotation.js";
import { outstandingDefaults } from "./reputation.js";
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
  const [lastKyc, rotation] = await Promise.all([
    ctx.db.kycSubmission.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" } }),
    ctx.db.keyRotationRequest.findFirst({
      where: { userId: u.id, status: { in: ["PENDING", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
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
    outstandingDefaults: await outstandingDefaults(ctx, u.id, u.walletAddress),
    pendingKeyRotation: pendingRotationView(rotation),
  };
}

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_PER_HOUR = 5;

/**
 * Sends a 6-digit code. PHONE_VERIFY proves a new phone number; STEP_UP re-confirms the user on their
 * verified phone before a sensitive change. Returns the code only in development with console SMS.
 */
export async function sendOtp(
  ctx: Ctx,
  user: User,
  phone: string,
  purpose: OtpPurpose = "PHONE_VERIFY",
): Promise<string | undefined> {
  if (purpose === "PHONE_VERIFY") {
    const owner = await ctx.db.user.findUnique({ where: { phone } });
    if (owner && owner.id !== user.id && owner.phoneVerifiedAt) throw conflict("เบอร์นี้ถูกใช้กับบัญชีอื่นแล้ว", "PHONE_TAKEN");
  }
  const recent = await ctx.db.otpChallenge.count({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 3600_000) } },
  });
  if (recent >= OTP_PER_HOUR) throw new AppError(429, "OTP_RATE", "ขอรหัสบ่อยเกินไป กรุณารอสักครู่");
  const code = randomDigits(6);
  await ctx.db.otpChallenge.create({
    data: {
      userId: user.id,
      purpose,
      phone,
      codeHash: hmac(ctx.config.HMAC_KEY, `otp:${user.id}:${code}`),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  await ctx.sms.send(phone, `รหัสยืนยัน Bank For All: ${code} (หมดอายุใน 5 นาที) ห้ามบอกรหัสนี้กับผู้อื่น`);
  return ctx.config.NODE_ENV !== "production" && ctx.config.SMS_PROVIDER === "console" ? code : undefined;
}

/** Checks and consumes the latest unexpired code of `purpose`; the attempt counter is atomic. */
async function consumeOtp(ctx: Ctx, user: User, code: string, purpose: OtpPurpose) {
  const challenge = await ctx.db.otpChallenge.findFirst({
    where: { userId: user.id, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) throw badRequest("รหัสหมดอายุ กรุณาขอรหัสใหม่", "OTP_EXPIRED");
  // reserve an attempt first so parallel guesses cannot exceed the limit
  const reserved = await ctx.db.otpChallenge.updateMany({
    where: { id: challenge.id, attempts: { lt: OTP_MAX_ATTEMPTS }, usedAt: null },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) throw badRequest("ใส่รหัสผิดเกินจำนวนครั้ง กรุณาขอรหัสใหม่", "OTP_LOCKED");
  const ok = safeEqual(challenge.codeHash, hmac(ctx.config.HMAC_KEY, `otp:${user.id}:${code}`));
  if (!ok) throw badRequest("รหัสไม่ถูกต้อง", "OTP_INVALID");
  const used = await ctx.db.otpChallenge.updateMany({
    where: { id: challenge.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count === 0) throw badRequest("รหัสถูกใช้ไปแล้ว", "OTP_USED");
  return challenge;
}

export async function verifyStepUp(ctx: Ctx, user: User, code: string | undefined) {
  if (!code) throw badRequest("กรุณายืนยันด้วยรหัส OTP ที่ส่งไปยังเบอร์ของคุณ", "STEP_UP_REQUIRED");
  await consumeOtp(ctx, user, code, "STEP_UP");
}

export async function verifyOtp(ctx: Ctx, user: User, code: string) {
  const challenge = await consumeOtp(ctx, user, code, "PHONE_VERIFY");
  await ctx.db.$transaction([
    ctx.db.user.updateMany({ where: { phone: challenge.phone, id: { not: user.id }, phoneVerifiedAt: null }, data: { phone: null } }),
    ctx.db.user.update({ where: { id: user.id }, data: { phone: challenge.phone, phoneVerifiedAt: new Date() } }),
  ]);
}

/** Masks a PromptPay ID for display: 081-xxx-5678. */
export function maskPromptPay(id: string): string {
  return id.length <= 4 ? id : `${id.slice(0, 3)}${"x".repeat(id.length - 7)}${id.slice(-4)}`;
}

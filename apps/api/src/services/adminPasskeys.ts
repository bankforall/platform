import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { AdminSecurityView } from "@bankforall/shared";
import type { FastifyRequest } from "fastify";
import { requireAdminSession, type Session } from "../auth/session.js";
import type { Ctx } from "../context.js";
import { Prisma, type User } from "../db.js";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";

/**
 * Admin second factor (WebAuthn passkeys) on top of LINE login.
 *
 * Policy (docs/v2/security.md):
 * - Mutating admin routes ("write") need a fresh step-up: a passkey assertion within ADMIN_STEPUP_TTL,
 *   bound to this login (session id = hash of the session token).
 * - Read-only admin routes ("read") need a registered passkey (when ADMIN_PASSKEY_REQUIRED), no step-up.
 * - ADMIN_PASSKEY_REQUIRED=false (development/test only): admins without a passkey pass freely; once an admin
 *   enrols one, the same step-up rules apply to them.
 * - The first passkey can be enrolled only within ENROL_WINDOW_SECONDS of a normal login; more passkeys need a
 *   step-up. Lost every device → `cli/clear-admin-passkeys.ts` (audited) and log in again.
 */

/** WebAuthn challenges live this long and are consumed on first use. */
export const CHALLENGE_TTL_SECONDS = 300;
/** The first passkey must be enrolled this soon after logging in. */
export const ENROL_WINDOW_SECONDS = 15 * 60;

export type AdminAccess = "read" | "write";
export type AdminGuardCode = "ADMIN_PASSKEY_REQUIRED" | "ADMIN_STEP_UP_REQUIRED";

const messages = {
  ADMIN_PASSKEY_REQUIRED: "ต้องลงทะเบียนพาสคีย์ผู้ดูแลก่อนใช้งานเมนูผู้ดูแล (ความปลอดภัยผู้ดูแล)",
  ADMIN_STEP_UP_REQUIRED: "กรุณายืนยันตัวตนด้วยพาสคีย์ก่อนทำรายการนี้",
  ADMIN_REAUTH_REQUIRED: "การลงทะเบียนพาสคีย์แรกต้องทำทันทีหลังเข้าสู่ระบบ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่",
} as const;

export const adminError = (code: keyof typeof messages) => new AppError(403, code, messages[code]);

/** Pure decision for an admin route. `null` = allowed. */
export function adminGuard(i: {
  required: boolean;
  passkeys: number;
  steppedUp: boolean;
  access: AdminAccess;
}): AdminGuardCode | null {
  if (i.passkeys === 0) return i.required ? "ADMIN_PASSKEY_REQUIRED" : null;
  if (i.access === "write" && !i.steppedUp) return "ADMIN_STEP_UP_REQUIRED";
  return null;
}

/** Pure decision for adding a passkey. */
export function enrolment(i: {
  passkeys: number;
  steppedUp: boolean;
  sessionAgeSeconds: number;
}): AdminSecurityView["enrolment"] {
  if (i.passkeys > 0) return i.steppedUp ? "open" : "step-up";
  return i.sessionAgeSeconds <= ENROL_WINDOW_SECONDS ? "open" : "relogin";
}

const stepUpKey = (session: Session) => `admin:stepup:${session.id}`;
const challengeKey = (purpose: "reg" | "auth", session: Session) => `webauthn:${purpose}:${session.id}`;

/** Expiry of this session's step-up, or null. */
export async function stepUpExpiry(ctx: Ctx, session: Session): Promise<Date | null> {
  const raw = await ctx.redis.get(stepUpKey(session));
  if (!raw) return null;
  const [userId, until] = raw.split(":");
  const at = Number(until);
  return userId === session.user.id && at > Date.now() ? new Date(at) : null;
}

async function grantStepUp(ctx: Ctx, session: Session): Promise<Date> {
  const ttl = ctx.config.ADMIN_STEPUP_TTL;
  const until = Date.now() + ttl * 1000;
  await ctx.redis.set(stepUpKey(session), `${session.user.id}:${until}`, "EX", ttl);
  return new Date(until);
}

/** Stores a challenge for this login; a new one replaces the previous. */
export async function saveChallenge(ctx: Ctx, purpose: "reg" | "auth", session: Session, challenge: string) {
  await ctx.redis.set(challengeKey(purpose, session), challenge, "EX", CHALLENGE_TTL_SECONDS);
}

/** Single use: atomically read and delete (GETDEL). */
export async function takeChallenge(ctx: Ctx, purpose: "reg" | "auth", session: Session): Promise<string> {
  const challenge = await ctx.redis.getdel(challengeKey(purpose, session));
  if (!challenge) throw badRequest("คำขอยืนยันพาสคีย์หมดเวลาหรือถูกใช้แล้ว กรุณาลองใหม่", "WEBAUTHN_CHALLENGE_EXPIRED");
  return challenge;
}

const passkeyCount = (ctx: Ctx, userId: string) => ctx.db.adminPasskey.count({ where: { userId } });

/**
 * Admin guard for routes: role ADMIN + the passkey policy above. Use "write" for anything that changes state.
 */
export async function requireAdminAccess(ctx: Ctx, req: FastifyRequest, access: AdminAccess): Promise<User> {
  const session = await requireAdminSession(ctx, req);
  const passkeys = await passkeyCount(ctx, session.user.id);
  const steppedUp = passkeys > 0 && access === "write" ? (await stepUpExpiry(ctx, session)) !== null : false;
  const code = adminGuard({ required: ctx.config.ADMIN_PASSKEY_REQUIRED, passkeys, steppedUp, access });
  if (code) throw adminError(code);
  return session.user;
}

export async function securityView(ctx: Ctx, session: Session): Promise<AdminSecurityView> {
  const passkeys = await ctx.db.adminPasskey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });
  const until = await stepUpExpiry(ctx, session);
  return {
    required: ctx.config.ADMIN_PASSKEY_REQUIRED,
    passkeys: passkeys.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    })),
    stepUpExpiresAt: until?.toISOString() ?? null,
    enrolment: enrolment({
      passkeys: passkeys.length,
      steppedUp: until !== null,
      sessionAgeSeconds: (Date.now() - session.issuedAt.getTime()) / 1000,
    }),
  };
}

async function assertCanEnrol(ctx: Ctx, session: Session) {
  const view = await securityView(ctx, session);
  if (view.enrolment === "step-up") throw adminError("ADMIN_STEP_UP_REQUIRED");
  if (view.enrolment === "relogin") throw adminError("ADMIN_REAUTH_REQUIRED");
}

const rp = (ctx: Ctx) => ({ rpID: ctx.config.WEBAUTHN_RP_ID, origin: ctx.config.WEBAUTHN_ORIGIN });

export async function registrationOptions(ctx: Ctx, session: Session) {
  await assertCanEnrol(ctx, session);
  const existing = await ctx.db.adminPasskey.findMany({ where: { userId: session.user.id } });
  const options = await generateRegistrationOptions({
    rpName: ctx.config.WEBAUTHN_RP_NAME,
    rpID: rp(ctx).rpID,
    userName: session.user.displayName,
    userDisplayName: session.user.displayName,
    // stable per account (not PII): the same authenticator replaces rather than duplicates its passkey
    userID: new TextEncoder().encode(session.user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    timeout: CHALLENGE_TTL_SECONDS * 1000,
  });
  await saveChallenge(ctx, "reg", session, options.challenge);
  return options;
}

export async function registerPasskey(ctx: Ctx, session: Session, name: string, response: Record<string, unknown>) {
  const expectedChallenge = await takeChallenge(ctx, "reg", session);
  await assertCanEnrol(ctx, session);
  const first = (await passkeyCount(ctx, session.user.id)) === 0;
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp(ctx).origin,
      expectedRPID: rp(ctx).rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    ctx.log.warn({ err, userId: session.user.id }, "passkey registration rejected");
    throw badRequest("ลงทะเบียนพาสคีย์ไม่สำเร็จ กรุณาลองใหม่", "PASSKEY_INVALID");
  }
  if (!verification.verified) throw badRequest("ลงทะเบียนพาสคีย์ไม่สำเร็จ กรุณาลองใหม่", "PASSKEY_INVALID");
  const { credential } = verification.registrationInfo;
  let created;
  try {
    created = await ctx.db.adminPasskey.create({
      data: {
        userId: session.user.id,
        credentialId: credential.id,
        publicKey: credential.publicKey as Uint8Array<ArrayBuffer>,
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        name,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("พาสคีย์นี้ลงทะเบียนไว้แล้ว", "PASSKEY_EXISTS");
    }
    throw err;
  }
  await audit(ctx, session.user.id, "admin.passkey.register", created.id, { name, first });
  await notify(ctx, {
    userId: session.user.id,
    kind: "security",
    title: "เพิ่มพาสคีย์ผู้ดูแลแล้ว",
    body: `เพิ่มพาสคีย์ "${name}" ในบัญชีผู้ดูแล หากคุณไม่ได้ทำรายการนี้ ให้แจ้งทีมทันที`,
  });
  // registration required user verification on the new passkey: counts as a step-up
  await grantStepUp(ctx, session);
  return securityView(ctx, session);
}

export async function stepUpOptions(ctx: Ctx, session: Session) {
  const passkeys = await ctx.db.adminPasskey.findMany({ where: { userId: session.user.id } });
  if (!passkeys.length) throw adminError("ADMIN_PASSKEY_REQUIRED");
  const options = await generateAuthenticationOptions({
    rpID: rp(ctx).rpID,
    allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
    userVerification: "required",
    timeout: CHALLENGE_TTL_SECONDS * 1000,
  });
  await saveChallenge(ctx, "auth", session, options.challenge);
  return options;
}

export async function stepUp(ctx: Ctx, session: Session, response: Record<string, unknown>): Promise<Date> {
  const expectedChallenge = await takeChallenge(ctx, "auth", session);
  const fail = async (reason: string, err?: unknown) => {
    ctx.log.warn({ err, userId: session.user.id, reason }, "admin step-up rejected");
    await audit(ctx, session.user.id, "admin.stepup.failed", session.user.id, { reason });
    return badRequest("ยืนยันพาสคีย์ไม่สำเร็จ กรุณาลองใหม่", "PASSKEY_INVALID");
  };
  const credentialId = typeof response.id === "string" ? response.id : "";
  const passkey = credentialId
    ? await ctx.db.adminPasskey.findFirst({ where: { credentialId, userId: session.user.id } })
    : null;
  if (!passkey) throw await fail("unknown credential");
  let newCounter: number;
  try {
    const result = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp(ctx).origin,
      expectedRPID: rp(ctx).rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });
    if (!result.verified) throw await fail("not verified");
    newCounter = result.authenticationInfo.newCounter;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw await fail("verification error", err);
  }
  await ctx.db.adminPasskey.update({
    where: { id: passkey.id },
    data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
  });
  const until = await grantStepUp(ctx, session);
  await audit(ctx, session.user.id, "admin.stepup", passkey.id, { until: until.toISOString() });
  return until;
}

/** Needs a step-up (route guard "write"); the last passkey stays while passkeys are required. */
export async function deletePasskey(ctx: Ctx, admin: User, id: string) {
  const passkey = await ctx.db.adminPasskey.findFirst({ where: { id, userId: admin.id } });
  if (!passkey) throw notFound("ไม่พบพาสคีย์");
  if (ctx.config.ADMIN_PASSKEY_REQUIRED && (await passkeyCount(ctx, admin.id)) <= 1) {
    throw conflict("ลบพาสคีย์สุดท้ายไม่ได้ เพิ่มพาสคีย์อื่นก่อน", "ADMIN_LAST_PASSKEY");
  }
  await ctx.db.adminPasskey.delete({ where: { id } });
  await audit(ctx, admin.id, "admin.passkey.delete", id, { name: passkey.name });
  await notify(ctx, {
    userId: admin.id,
    kind: "security",
    title: "ลบพาสคีย์ผู้ดูแลแล้ว",
    body: `ลบพาสคีย์ "${passkey.name}" ออกจากบัญชีผู้ดูแล หากคุณไม่ได้ทำรายการนี้ ให้แจ้งทีมทันที`,
  });
}

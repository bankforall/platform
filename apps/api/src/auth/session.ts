import { createHash } from "node:crypto";
import type { User } from "../db.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import type { Ctx } from "../context.js";
import { forbidden, unauthorized } from "../errors.js";

export const SESSION_COOKIE = "bfa_session";
const SESSION_DAYS = 30;

const key = (ctx: Ctx) => new TextEncoder().encode(ctx.config.SESSION_SECRET);

export async function startSession(ctx: Ctx, reply: FastifyReply, user: User) {
  const token = await new SignJWT({ v: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key(ctx));
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: ctx.config.PUBLIC_URL.startsWith("https://"),
    sameSite: "lax",
    maxAge: SESSION_DAYS * 86400,
  });
}

export function endSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** User id of a valid session token (signature + expiry only, no database lookup). */
export async function verifiedSubject(ctx: Ctx, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(ctx), { algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export interface Session {
  user: User;
  /** Stable id of this login (hash of the session token) — binds admin step-up and WebAuthn challenges to it. */
  id: string;
  /** When this login happened (JWT iat). */
  issuedAt: Date;
}

export async function currentSession(ctx: Ctx, req: FastifyRequest): Promise<Session | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(ctx), { algorithms: ["HS256"] });
    const user = await ctx.db.user.findUnique({ where: { id: payload.sub! } });
    if (!user || user.sessionVersion !== payload.v) return null;
    return {
      user,
      id: createHash("sha256").update(token).digest("hex"),
      issuedAt: new Date((payload.iat ?? 0) * 1000),
    };
  } catch {
    return null;
  }
}

export async function currentUser(ctx: Ctx, req: FastifyRequest): Promise<User | null> {
  return (await currentSession(ctx, req))?.user ?? null;
}

export async function requireUser(ctx: Ctx, req: FastifyRequest): Promise<User> {
  const user = await currentUser(ctx, req);
  if (!user) throw unauthorized();
  return user;
}

/** Admin role only — no second factor. Routes use `requireAdminAccess` (services/adminPasskeys.ts). */
export async function requireAdminSession(ctx: Ctx, req: FastifyRequest): Promise<Session> {
  const session = await currentSession(ctx, req);
  if (!session) throw unauthorized();
  if (session.user.role !== "ADMIN") throw forbidden();
  return session;
}

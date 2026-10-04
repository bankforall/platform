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

export async function currentUser(ctx: Ctx, req: FastifyRequest): Promise<User | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(ctx), { algorithms: ["HS256"] });
    const user = await ctx.db.user.findUnique({ where: { id: payload.sub! } });
    if (!user || user.sessionVersion !== payload.v) return null;
    return user;
  } catch {
    return null;
  }
}

export async function requireUser(ctx: Ctx, req: FastifyRequest): Promise<User> {
  const user = await currentUser(ctx, req);
  if (!user) throw unauthorized();
  return user;
}

export async function requireAdmin(ctx: Ctx, req: FastifyRequest): Promise<User> {
  const user = await requireUser(ctx, req);
  if (user.role !== "ADMIN") throw forbidden();
  return user;
}

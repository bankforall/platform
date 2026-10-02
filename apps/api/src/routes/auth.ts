import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { endSession, startSession } from "../auth/session.js";
import type { Ctx } from "../context.js";
import { safeEqual } from "../crypto.js";
import { notFound, parse } from "../errors.js";

const OAUTH_COOKIE = "bfa_oauth";
const loginError = (message: string) => `/login?error=${encodeURIComponent(message)}`;

/** Only same-site relative paths, to prevent open redirects. */
function safeRedirect(path: unknown): string {
  return typeof path === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(path) ? path : "/";
}

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/api/auth/line/start", async (req, reply) => {
    if (!ctx.line.loginEnabled) throw notFound("LINE Login ยังไม่ได้ตั้งค่า");
    const state = randomBytes(16).toString("hex");
    const nonce = randomBytes(16).toString("hex");
    const redirect = safeRedirect((req.query as { redirect?: string }).redirect);
    reply.setCookie(OAUTH_COOKIE, JSON.stringify({ state, nonce, redirect }), {
      path: "/api/auth/line",
      httpOnly: true,
      secure: ctx.config.PUBLIC_URL.startsWith("https://"),
      sameSite: "lax",
      maxAge: 600,
      signed: true,
    });
    return reply.redirect(ctx.line.authorizeUrl(state, nonce));
  });

  app.get("/api/auth/line/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const raw = req.cookies[OAUTH_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie(OAUTH_COOKIE, { path: "/api/auth/line" });
    if (q.error) return reply.redirect(loginError("ยกเลิกการเข้าสู่ระบบด้วย LINE"));
    const expired = loginError("การเข้าสู่ระบบหมดเวลา กรุณาลองใหม่");
    if (!unsigned?.valid || !unsigned.value || !q.code || !q.state) return reply.redirect(expired);
    const saved = JSON.parse(unsigned.value) as { state: string; nonce: string; redirect: string };
    if (!safeEqual(saved.state, q.state)) return reply.redirect(expired);

    let profile: Awaited<ReturnType<typeof ctx.line.exchange>>;
    try {
      profile = await ctx.line.exchange(q.code, saved.nonce);
    } catch (err) {
      req.log.error({ err }, "LINE login failed");
      return reply.redirect(loginError("เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่"));
    }
    const user = await ctx.db.user.upsert({
      where: { lineUserId: profile.userId },
      create: { lineUserId: profile.userId, displayName: profile.name, pictureUrl: profile.picture },
      update: { displayName: profile.name, pictureUrl: profile.picture },
    });
    await startSession(ctx, reply, user);
    return reply.redirect(safeRedirect(saved.redirect));
  });

  /** Local development and automated tests only (refused in production by config validation). */
  app.post("/api/auth/dev-login", async (req, reply) => {
    if (!ctx.config.DEV_LOGIN) throw notFound();
    const body = parse(z.object({ displayName: z.string().trim().min(1).max(50) }), req.body);
    const lineUserId = `dev:${body.displayName}`;
    const user = await ctx.db.user.upsert({
      where: { lineUserId },
      create: { lineUserId, displayName: body.displayName },
      update: {},
    });
    await startSession(ctx, reply, user);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    endSession(reply);
    return { ok: true };
  });

  app.get("/api/config", async () => ({
    chainId: ctx.chain.chainId,
    forwarder: ctx.chain.forwarder,
    factory: ctx.chain.factory,
    explorerUrl: ctx.config.EXPLORER_URL || null,
    lineLoginEnabled: ctx.line.loginEnabled,
    devLoginEnabled: ctx.config.DEV_LOGIN,
  }));

}

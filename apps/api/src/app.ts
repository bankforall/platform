import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import type { Ctx } from "./context.js";
import { AppError } from "./errors.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { circleRoutes } from "./routes/circles.js";
import { meRoutes } from "./routes/me.js";

export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "bankforall";

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: opts.logger === false ? undefined : ctx.log,
    trustProxy: true, // behind Caddy
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false }); // CSP is set by the web server
  await app.register(cookie, { secret: ctx.config.SESSION_SECRET });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 2, fields: 10 } });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    redis: ctx.redis,
    nameSpace: "rl:",
    // per session when logged in (many Thai mobile users share one carrier-NAT IP), else per IP
    keyGenerator: (req) => {
      const session = /(?:^|;\s*)bfa_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      return session ? `s:${createHash("sha256").update(session).digest("hex").slice(0, 32)}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: { code: "RATE_LIMITED", message: "ทำรายการถี่เกินไป กรุณารอสักครู่" },
    }),
  });

  // CSRF: state-changing requests must carry a custom header, which browsers never add cross-site
  // without a CORS preflight (and the API answers no CORS). SameSite=Lax cookies are a second layer.
  app.addHook("onRequest", async (req) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) throw new AppError(403, "CSRF", "invalid request origin");
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "ทำรายการถี่เกินไป กรุณารอสักครู่" } });
    }
    if (status < 500) {
      const e = err as { code?: string; message?: string };
      return reply.status(status).send({ error: { code: e.code ?? "BAD_REQUEST", message: e.message ?? "bad request" } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "INTERNAL", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", message: "ไม่พบ" } }));

  app.get("/api/health", async (_req, reply) => {
    const checks = await Promise.allSettled([
      ctx.db.$queryRaw`SELECT 1`,
      ctx.redis.ping(),
      ctx.chain.publicClient.getBlockNumber(),
      ctx.storage.ping(),
    ]);
    const [db, redis, chain, storage] = checks.map((c) => c.status === "fulfilled");
    const ok = db && redis && chain && storage;
    // degraded (still 200): needs an operator but users can keep reading
    const [heartbeat, gasLow] = await Promise.all([
      ctx.redis.get("worker:heartbeat").catch(() => null),
      ctx.redis.get("ops:gas-low").catch(() => null),
    ]);
    const worker = heartbeat !== null && Date.now() - Number(heartbeat) < 2 * 60_000;
    return reply.status(ok ? 200 : 503).send({ ok, db, redis, chain, storage, worker, gasLow: gasLow !== null });
  });

  authRoutes(app, ctx);
  meRoutes(app, ctx);
  circleRoutes(app, ctx);
  adminRoutes(app, ctx);
  return app;
}

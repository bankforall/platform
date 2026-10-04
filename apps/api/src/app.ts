import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Ctx } from "./context.js";
import { verifiedSubject } from "./auth/session.js";
import { AppError } from "./errors.js";
import { PolicyError } from "./signer/policy.js";
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
    // per user when the session verifies (many Thai mobile users share one carrier-NAT IP), else per IP;
    // an unverified cookie never gets its own bucket
    keyGenerator: async (req) => {
      const token = /(?:^|;\s*)bfa_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      const userId = token ? await verifiedSubject(ctx, token) : null;
      return userId ? `u:${userId}` : `ip:${req.ip}`;
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
    if (err instanceof PolicyError) {
      req.log.warn({ code: err.code }, "signer refused");
      const message =
        err.code === "KYC_REQUIRED"
          ? "ต้องยืนยันตัวตนให้เรียบร้อยก่อน"
          : err.code === "ROTATION_PENDING"
            ? "บัญชีกำลังเปลี่ยนกุญแจ กรุณารอให้เสร็จก่อน"
            : err.code === "CIRCLE_NOT_OPEN"
              ? "วงนี้ไม่เปิดรับสมาชิกแล้ว"
              : "ไม่สามารถยืนยันรายการนี้ได้";
      return reply.status(403).send({ error: { code: err.code, message } });
    }
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

  // cached briefly: the endpoint is public and each check touches DB, Redis, RPC and S3
  let healthCache: { at: number; status: number; body: object } | null = null;
  app.get("/api/health", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (_req, reply) => {
    if (healthCache && Date.now() - healthCache.at < 5_000) {
      return reply.status(healthCache.status).send(healthCache.body);
    }
    const checks = await Promise.allSettled([
      ctx.db.$queryRaw`SELECT 1`,
      ctx.redis.ping(),
      ctx.chain.publicClient.getBlockNumber(),
      ctx.storage.ping(),
    ]);
    const [db, redis, chain, storage] = checks.map((c) => c.status === "fulfilled");
    const ok = db && redis && chain && storage;
    // degraded (still 200): needs an operator but users can keep reading
    const [heartbeat, gasKeys] = await Promise.all([
      ctx.redis.get("worker:heartbeat").catch(() => null),
      ctx.redis
        .mget("ops:gas-low:relayer", "ops:gas-low:keeper", "ops:gas-low:attester")
        .then((v) => v.filter((x) => x !== null))
        .catch(() => [] as string[]),
    ]);
    const worker = heartbeat !== null && Date.now() - Number(heartbeat) < 2 * 60_000;
    const body = { ok, db, redis, chain, storage, worker, gasLow: gasKeys.length > 0 };
    healthCache = { at: Date.now(), status: ok ? 200 : 503, body };
    return reply.status(ok ? 200 : 503).send(body);
  });

  authRoutes(app, ctx);
  meRoutes(app, ctx);
  circleRoutes(app, ctx);
  adminRoutes(app, ctx);
  return app;
}

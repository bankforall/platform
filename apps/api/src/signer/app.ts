import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { z } from "zod";
import { safeEqual } from "../crypto.js";
import { encodeJson } from "./client.js";
import { attestSlipTx, issueAttestation, PolicyError, rotationSignatures, type SignerCtx } from "./policy.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

/**
 * HTTP API of the signer service. Every request needs the shared bearer token and is re-checked
 * against the database by the policy before anything is signed.
 */
export function buildSignerApp(ctx: SignerCtx, log?: FastifyBaseLogger): FastifyInstance {
  const app = Fastify({ loggerInstance: log, bodyLimit: 16 * 1024 });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!safeEqual(token, ctx.config.SIGNER_TOKEN)) return reply.status(401).send({ code: "UNAUTHORIZED" });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof PolicyError) {
      req.log.warn({ code: err.code, url: req.url }, "signing refused by policy");
      return reply.status(403).send({ code: err.code, message: err.message });
    }
    if (err instanceof z.ZodError) return reply.status(400).send({ code: "BAD_REQUEST", message: err.message });
    req.log.error({ err }, "signer error");
    return reply.status(500).send({ code: "SIGNER_ERROR", message: "internal error" });
  });

  app.post("/attestation", async (req, reply) => {
    const body = z.object({ subject: address, circle: address }).parse(req.body);
    const result = await issueAttestation(ctx, body.subject as `0x${string}`, body.circle as `0x${string}`);
    req.log.info({ subject: body.subject, circle: body.circle }, "attestation issued");
    return reply.type("application/json").send(encodeJson(result));
  });

  app.post("/attest-slip", async (req, reply) => {
    const { slipId } = z.object({ slipId: z.string().min(1) }).parse(req.body);
    const hash = await attestSlipTx(ctx, slipId);
    req.log.info({ slipId, hash }, "slip attested");
    return reply.type("application/json").send(encodeJson({ hash }));
  });

  app.post("/rotation-signatures", async (req, reply) => {
    const { requestId } = z.object({ requestId: z.string().min(1) }).parse(req.body);
    const sigs = await rotationSignatures(ctx, requestId);
    req.log.warn({ requestId, circles: sigs.length }, "key rotation signatures issued");
    return reply.type("application/json").send(encodeJson(sigs));
  });

  app.get("/health", async () => ({ ok: true }));
  return app;
}

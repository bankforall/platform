import type { FastifyInstance } from "fastify";
import { kycDecisionBody, rotateKeyBody } from "@bankforall/shared";
import type { Address } from "viem";
import { z } from "zod";
import { requireAdmin } from "../auth/session.js";
import type { Ctx } from "../context.js";
import { parse } from "../errors.js";
import { decideKyc, kycFile, listKyc, rotateUserKey } from "../services/kyc.js";

export function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/api/admin/kyc", async (req) => {
    await requireAdmin(ctx, req);
    const { status } = parse(
      z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING") }),
      req.query,
    );
    return listKyc(ctx, status);
  });

  app.get("/api/admin/kyc/:id/:file", async (req, reply) => {
    await requireAdmin(ctx, req);
    const { id, file } = parse(z.object({ id: z.string(), file: z.enum(["idCard", "selfie"]) }), req.params);
    const data = await kycFile(ctx, id, file);
    return reply.type("image/jpeg").header("Cache-Control", "private, no-store").send(data);
  });

  app.post("/api/admin/kyc/:id/decision", async (req) => {
    const admin = await requireAdmin(ctx, req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await decideKyc(ctx, admin, id, parse(kycDecisionBody, req.body));
    return { ok: true };
  });

  app.post("/api/admin/users/:id/rotate-key", async (req) => {
    const admin = await requireAdmin(ctx, req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { newAddress } = parse(rotateKeyBody, req.body);
    req.log.warn({ admin: admin.id, user: id, newAddress }, "key rotation requested");
    return rotateUserKey(ctx, id, newAddress as Address);
  });
}

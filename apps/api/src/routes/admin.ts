import type { FastifyInstance } from "fastify";
import { kycDecisionBody } from "@bankforall/shared";
import { z } from "zod";
import { requireAdmin } from "../auth/session.js";
import type { Ctx } from "../context.js";
import { parse } from "../errors.js";
import { audit } from "../services/audit.js";
import { decideKyc, kycFile, listKyc } from "../services/kyc.js";
import { approveRotation, listRotations, rejectRotation } from "../services/rotation.js";
import { listDeletionRequests } from "../services/privacy.js";

const idParams = z.object({ id: z.string().min(1) });

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
    const admin = await requireAdmin(ctx, req);
    const { id, file } = parse(z.object({ id: z.string(), file: z.enum(["idCard", "selfie"]) }), req.params);
    const { data, contentType } = await kycFile(ctx, id, file);
    await audit(ctx, admin.id, "kyc.view", id, { file });
    return reply.type(contentType).header("Cache-Control", "private, no-store").send(data);
  });

  app.post("/api/admin/kyc/:id/decision", async (req) => {
    const admin = await requireAdmin(ctx, req);
    const { id } = parse(idParams, req.params);
    await decideKyc(ctx, admin, id, parse(kycDecisionBody, req.body));
    return { ok: true };
  });

  app.get("/api/admin/key-rotations", async (req) => {
    await requireAdmin(ctx, req);
    const { status } = parse(
      z.object({ status: z.enum(["PENDING", "APPROVED", "EXECUTED", "CANCELLED", "FAILED"]).default("PENDING") }),
      req.query,
    );
    return listRotations(ctx, status);
  });

  app.post("/api/admin/key-rotations/:id/approve", async (req) => {
    const admin = await requireAdmin(ctx, req);
    const { id } = parse(idParams, req.params);
    return approveRotation(ctx, admin, id);
  });

  app.post("/api/admin/key-rotations/:id/reject", async (req) => {
    const admin = await requireAdmin(ctx, req);
    const { id } = parse(idParams, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
    await rejectRotation(ctx, admin, id, reason);
    return { ok: true };
  });

  // PDPA account deletion requests (read-only: the worker decides and executes)
  app.get("/api/admin/deletion-requests", async (req) => {
    await requireAdmin(ctx, req);
    const { status } = parse(
      z.object({ status: z.enum(["PENDING", "CANCELLED", "REFUSED", "COMPLETED"]).default("PENDING") }),
      req.query,
    );
    return listDeletionRequests(ctx, status);
  });
}

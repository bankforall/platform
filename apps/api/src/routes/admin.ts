import type { FastifyInstance } from "fastify";
import { kycDecisionBody, passkeyAssertionBody, passkeyRegisterBody } from "@bankforall/shared";
import { z } from "zod";
import { requireAdminSession } from "../auth/session.js";
import type { Ctx } from "../context.js";
import { parse } from "../errors.js";
import {
  deletePasskey,
  registerPasskey,
  registrationOptions,
  requireAdminAccess,
  securityView,
  stepUp,
  stepUpOptions,
} from "../services/adminPasskeys.js";
import { audit } from "../services/audit.js";
import { decideKyc, kycFile, listKyc } from "../services/kyc.js";
import { approveRotation, listRotations, rejectRotation } from "../services/rotation.js";
import { listDeletionRequests } from "../services/privacy.js";

const idParams = z.object({ id: z.string().min(1) });

/** WebAuthn ceremonies: a few per minute is plenty for a person, and slows down guessing. */
const passkeyLimit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

/**
 * Every route here goes through `requireAdminAccess`: "read" needs a registered passkey (when required),
 * "write" (anything that changes state) also needs a fresh passkey step-up — see services/adminPasskeys.ts.
 * The /api/admin/security and passkey ceremony routes need only an admin session (they are how you get there).
 */
export function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  // ── admin passkeys (2FA) ──
  app.get("/api/admin/security", async (req) => securityView(ctx, await requireAdminSession(ctx, req)));

  app.post("/api/admin/passkeys/register/options", passkeyLimit, async (req) =>
    registrationOptions(ctx, await requireAdminSession(ctx, req)),
  );

  app.post("/api/admin/passkeys/register/verify", passkeyLimit, async (req) => {
    const session = await requireAdminSession(ctx, req);
    const { name, response } = parse(passkeyRegisterBody, req.body);
    return registerPasskey(ctx, session, name, response);
  });

  app.post("/api/admin/step-up/options", passkeyLimit, async (req) =>
    stepUpOptions(ctx, await requireAdminSession(ctx, req)),
  );

  app.post("/api/admin/step-up/verify", passkeyLimit, async (req) => {
    const session = await requireAdminSession(ctx, req);
    const { response } = parse(passkeyAssertionBody, req.body);
    const until = await stepUp(ctx, session, response);
    return { expiresAt: until.toISOString() };
  });

  app.delete("/api/admin/passkeys/:id", async (req) => {
    const admin = await requireAdminAccess(ctx, req, "write");
    const { id } = parse(idParams, req.params);
    await deletePasskey(ctx, admin, id);
    return { ok: true };
  });

  // ── KYC ──
  app.get("/api/admin/kyc", async (req) => {
    await requireAdminAccess(ctx, req, "read");
    const { status } = parse(
      z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING") }),
      req.query,
    );
    return listKyc(ctx, status);
  });

  app.get("/api/admin/kyc/:id/:file", async (req, reply) => {
    const admin = await requireAdminAccess(ctx, req, "read");
    const { id, file } = parse(z.object({ id: z.string(), file: z.enum(["idCard", "selfie"]) }), req.params);
    const { data, contentType } = await kycFile(ctx, id, file);
    await audit(ctx, admin.id, "kyc.view", id, { file });
    return reply.type(contentType).header("Cache-Control", "private, no-store").send(data);
  });

  app.post("/api/admin/kyc/:id/decision", async (req) => {
    const admin = await requireAdminAccess(ctx, req, "write");
    const { id } = parse(idParams, req.params);
    await decideKyc(ctx, admin, id, parse(kycDecisionBody, req.body));
    return { ok: true };
  });

  // ── key rotations ──
  app.get("/api/admin/key-rotations", async (req) => {
    await requireAdminAccess(ctx, req, "read");
    const { status } = parse(
      z.object({ status: z.enum(["PENDING", "APPROVED", "EXECUTED", "CANCELLED", "FAILED"]).default("PENDING") }),
      req.query,
    );
    return listRotations(ctx, status);
  });

  app.post("/api/admin/key-rotations/:id/approve", async (req) => {
    const admin = await requireAdminAccess(ctx, req, "write");
    const { id } = parse(idParams, req.params);
    return approveRotation(ctx, admin, id);
  });

  app.post("/api/admin/key-rotations/:id/reject", async (req) => {
    const admin = await requireAdminAccess(ctx, req, "write");
    const { id } = parse(idParams, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
    await rejectRotation(ctx, admin, id, reason);
    return { ok: true };
  });

  // PDPA account deletion requests (read-only: the worker decides and executes)
  app.get("/api/admin/deletion-requests", async (req) => {
    await requireAdminAccess(ctx, req, "read");
    const { status } = parse(
      z.object({ status: z.enum(["PENDING", "CANCELLED", "REFUSED", "COMPLETED"]).default("PENDING") }),
      req.query,
    );
    return listDeletionRequests(ctx, status);
  });
}

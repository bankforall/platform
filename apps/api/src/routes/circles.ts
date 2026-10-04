import type { FastifyInstance } from "fastify";
import { commitBidBody, createCircleBody, disputeBody, joinCircleBody, submitIntentBody } from "@bankforall/shared";
import type { Hex } from "viem";
import { z } from "zod";
import { requireUser } from "../auth/session.js";
import type { Ctx } from "../context.js";
import { forbidden, notFound, parse } from "../errors.js";
import {
  byInvite,
  canSeeSlip,
  detailView,
  discover,
  listMine,
  myPromptPay,
  prepareCommitBid,
  prepareConfirm,
  prepareCreate,
  prepareDispute,
  prepareHostAction,
  prepareJoin,
  preparePayment,
  prepareReject,
} from "../services/circles.js";
import { evidenceHtml } from "../services/evidence.js";
import { intentView, submitIntent } from "../services/intents.js";
import { checkImage } from "../services/kyc.js";
import { readMultipart } from "./me.js";

const idParams = z.object({ id: z.string().min(1) });
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export function circleRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/api/circles", async (req) => listMine(ctx, await requireUser(ctx, req)));
  app.get("/api/circles/discover", async (req) => discover(ctx, await requireUser(ctx, req)));
  app.get("/api/circles/invite/:code", async (req) =>
    byInvite(ctx, await requireUser(ctx, req), (req.params as { code: string }).code),
  );
  app.get("/api/circles/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    return detailView(ctx, id, await requireUser(ctx, req)); // member names are personal data
  });

  app.post("/api/circles", async (req) => prepareCreate(ctx, await requireUser(ctx, req), parse(createCircleBody, req.body)));

  app.post("/api/circles/:id/join", async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(joinCircleBody, req.body ?? {});
    return prepareJoin(ctx, await requireUser(ctx, req), id, body.seat, body.inviteCode);
  });

  for (const action of ["start", "cancel"] as const) {
    app.post(`/api/circles/:id/${action}`, async (req) => {
      const { id } = parse(idParams, req.params);
      return prepareHostAction(ctx, await requireUser(ctx, req), id, action);
    });
  }

  app.post("/api/circles/:id/bids", async (req) => {
    const { id } = parse(idParams, req.params);
    const { hash } = parse(commitBidBody, req.body);
    return prepareCommitBid(ctx, await requireUser(ctx, req), id, hash as Hex);
  });

  app.get("/api/circles/:id/promptpay", async (req) => {
    const { id } = parse(idParams, req.params);
    return myPromptPay(ctx, await requireUser(ctx, req), id);
  });

  app.post("/api/circles/:id/payments", async (req) => {
    const { id } = parse(idParams, req.params);
    const user = await requireUser(ctx, req);
    const { files } = await readMultipart(req);
    return preparePayment(ctx, user, id, checkImage(files.slip, "สลิป"));
  });

  app.post("/api/circles/:id/payments/:payer/confirm", async (req) => {
    const { id, payer } = parse(idParams.extend({ payer: address }), req.params);
    return prepareConfirm(ctx, await requireUser(ctx, req), id, payer);
  });

  app.post("/api/circles/:id/payments/:payer/reject", async (req) => {
    const { id, payer } = parse(idParams.extend({ payer: address }), req.params);
    return prepareReject(ctx, await requireUser(ctx, req), id, payer);
  });

  app.post("/api/circles/:id/disputes", async (req) => {
    const { id } = parse(idParams, req.params);
    const { round, reason } = parse(disputeBody, req.body);
    return prepareDispute(ctx, await requireUser(ctx, req), id, round, reason);
  });

  app.get("/api/circles/:id/evidence", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const html = await evidenceHtml(ctx, await requireUser(ctx, req), id);
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'",
      )
      .send(html);
  });

  app.get("/api/slips/:id", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const slip = await canSeeSlip(ctx, await requireUser(ctx, req), id);
    const data = await ctx.storage.get(slip.storageKey);
    return reply.type(slip.contentType).header("Cache-Control", "private, no-store").send(data);
  });

  // ─────────────── intents ───────────────

  app.post("/api/intents/:id/submit", async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(submitIntentBody, req.body);
    return submitIntent(ctx, await requireUser(ctx, req), id, body.signature as Hex, body.bid);
  });

  app.get("/api/intents/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const user = await requireUser(ctx, req);
    const intent = await ctx.db.txIntent.findUnique({ where: { id } });
    if (!intent) throw notFound();
    if (intent.userId !== user.id) throw forbidden();
    return intentView(intent);
  });

}

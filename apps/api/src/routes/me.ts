import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  keyRotationRequestBody,
  walletProofMessage,
  consentBody,
  kycFields,
  parsePromptPayId,
  promptPayBody,
  sendOtpBody,
  verifyOtpBody,
  walletBody,
} from "@bankforall/shared";
import { requireUser } from "../auth/session.js";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound, parse } from "../errors.js";
import { checkImage, sniffImage, submitKyc, type Upload } from "../services/kyc.js";
import { cancelDeletion, exportUserData, requestDeletion } from "../services/privacy.js";
import { z } from "zod";
import { cancelRotation, requestRotation } from "../services/rotation.js";
import { meView, sendOtp, verifyOtp, verifyStepUp } from "../services/users.js";
import { notify } from "../services/notify.js";
import { getAddress, verifyMessage, type Hex } from "viem";

export async function readMultipart(req: FastifyRequest) {
  const fields: Record<string, string> = {};
  const files: Record<string, Upload> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      files[part.fieldname] = { data: await part.toBuffer(), contentType: part.mimetype };
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { fields, files };
}

export function meRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/api/me", async (req) => meView(ctx, await requireUser(ctx, req)));

  app.post("/api/me/phone/otp", async (req) => {
    const user = await requireUser(ctx, req);
    const { phone } = parse(sendOtpBody, req.body);
    const devCode = await sendOtp(ctx, user, phone);
    return devCode ? { ok: true, devCode } : { ok: true };
  });

  app.post("/api/me/phone/verify", async (req) => {
    const user = await requireUser(ctx, req);
    const { code } = parse(verifyOtpBody, req.body);
    await verifyOtp(ctx, user, code);
    return meView(ctx, (await ctx.db.user.findUnique({ where: { id: user.id } }))!);
  });

  app.post("/api/me/step-up/otp", async (req) => {
    const user = await requireUser(ctx, req);
    if (!user.phone || !user.phoneVerifiedAt) throw badRequest("ยังไม่ได้ยืนยันเบอร์มือถือ", "NO_PHONE");
    const devCode = await sendOtp(ctx, user, user.phone, "STEP_UP");
    return devCode ? { ok: true, devCode } : { ok: true };
  });

  app.put("/api/me/promptpay", async (req) => {
    const user = await requireUser(ctx, req);
    const { promptPayId, code } = parse(promptPayBody, req.body);
    if (user.promptPayId) {
      // changing where people send money: re-confirm the person and refuse mid-round as a recipient
      if (user.walletAddress) {
        const rounds = await ctx.db.round.findMany({
          where: { recipient: user.walletAddress, decided: true, circle: { status: "ACTIVE" } },
          include: { circle: { select: { currentRound: true } } },
        });
        const current = rounds.filter((r) => r.number === r.circle.currentRound);
        const open = current.length
          ? await ctx.db.payment.count({
              where: {
                OR: current.map((r) => ({ circleId: r.circleId, round: r.number })),
                status: { in: ["NONE", "DECLARED"] },
              },
            })
          : 0;
        if (open > 0) {
          throw conflict("เปลี่ยนพร้อมเพย์ไม่ได้ระหว่างที่คุณเป็นผู้รับเงินของรอบที่ยังไม่ปิด", "RECIPIENT_LOCKED");
        }
      }
      await verifyStepUp(ctx, user, code);
    }
    let normalized: string;
    try {
      normalized = parsePromptPayId(promptPayId).id;
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const updated = await ctx.db.user.update({ where: { id: user.id }, data: { promptPayId: normalized } });
    if (user.promptPayId && user.promptPayId !== normalized) {
      await notify(ctx, {
        userId: user.id,
        kind: "security",
        title: "เปลี่ยนบัญชีพร้อมเพย์แล้ว",
        body: "หากคุณไม่ได้ทำรายการนี้ ให้ติดต่อเจ้าหน้าที่ทันที",
      });
      req.log.warn({ userId: user.id }, "promptpay changed");
    }
    return meView(ctx, updated);
  });

  app.post("/api/me/consent", async (req) => {
    const user = await requireUser(ctx, req);
    const { version } = parse(consentBody, req.body);
    const updated = await ctx.db.user.update({
      where: { id: user.id },
      data: { consentVersion: version, consentAt: new Date() },
    });
    return meView(ctx, updated);
  });

  app.put("/api/me/wallet", async (req) => {
    const user = await requireUser(ctx, req);
    const body = parse(walletBody, req.body);
    const address = body.address.toLowerCase();
    const owns = await verifyMessage({
      address: getAddress(address),
      message: walletProofMessage(user.id, address),
      signature: body.proof as Hex,
    }).catch(() => false);
    if (!owns) throw badRequest("ลายเซ็นยืนยันกุญแจไม่ถูกต้อง", "BAD_PROOF");
    // the key itself can only change through staff-approved rotation; the backup may be refreshed
    if (user.walletAddress && user.walletAddress !== address) {
      throw conflict("บัญชีนี้มีกุญแจอยู่แล้ว หากเปลี่ยนเครื่องให้ใช้รหัสกู้คืน", "WALLET_EXISTS");
    }
    const owner = await ctx.db.user.findUnique({ where: { walletAddress: address } });
    if (owner && owner.id !== user.id) throw conflict("ที่อยู่นี้ถูกใช้แล้ว", "WALLET_TAKEN");
    const updated = await ctx.db.user.update({
      where: { id: user.id },
      data: { walletAddress: address, walletBackup: body.backup },
    });
    return meView(ctx, updated);
  });

  app.post("/api/me/key-rotation", async (req) => {
    const user = await requireUser(ctx, req);
    const body = parse(keyRotationRequestBody, req.body);
    await requestRotation(ctx, user, body.newAddress as `0x${string}`, body.proof as Hex);
    return meView(ctx, user);
  });

  app.delete("/api/me/key-rotation", async (req) => {
    const user = await requireUser(ctx, req);
    await cancelRotation(ctx, user);
    return meView(ctx, user);
  });

  app.get("/api/me/wallet/backup", async (req) => {
    const user = await requireUser(ctx, req);
    if (!user.walletBackup) throw notFound("ไม่พบข้อมูลสำรอง");
    return user.walletBackup;
  });

  app.post("/api/me/kyc", async (req) => {
    const user = await requireUser(ctx, req);
    const { fields, files } = await readMultipart(req);
    const { fullName, nationalId } = parse(kycFields, fields);
    await submitKyc(ctx, user, {
      fullName,
      nationalId,
      idCard: checkImage(files.idCard, "รูปบัตรประชาชน"),
      selfie: checkImage(files.selfie, "รูปถ่ายคู่บัตร"),
    });
    return meView(ctx, (await ctx.db.user.findUnique({ where: { id: user.id } }))!);
  });

  // ─────────────── PDPA rights ───────────────

  /** Download of all personal data held about the user (right of access / portability). */
  app.get("/api/me/export", { config: { rateLimit: { max: 1, timeWindow: "1 hour" } } }, async (req, reply) => {
    const user = await requireUser(ctx, req);
    const data = await exportUserData(ctx, user);
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .type("application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="my-data-${date}.json"`)
      .header("Cache-Control", "private, no-store")
      .send(JSON.stringify(data, null, 2));
  });

  /** The user's own KYC images (linked from the export). */
  app.get("/api/me/kyc/:id/:file", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { id, file } = parse(z.object({ id: z.string(), file: z.enum(["idCard", "selfie"]) }), req.params);
    const k = await ctx.db.kycSubmission.findUnique({ where: { id } });
    if (!k || k.userId !== user.id || k.purgedAt) throw notFound();
    const data = await ctx.storage.get(file === "idCard" ? k.idCardKey : k.selfieKey);
    return reply
      .type(sniffImage(data) ?? "application/octet-stream")
      .header("Cache-Control", "private, no-store")
      .send(data);
  });

  /** Account deletion: refused while others rely on the user; executed by the worker after a cooling-off period. */
  app.post("/api/me/deletion-request", async (req) => {
    const user = await requireUser(ctx, req);
    await requestDeletion(ctx, user);
    return meView(ctx, user);
  });

  app.delete("/api/me/deletion-request", async (req) => {
    const user = await requireUser(ctx, req);
    await cancelDeletion(ctx, user);
    return meView(ctx, user);
  });

  app.get("/api/me/notifications", async (req) => {
    const user = await requireUser(ctx, req);
    const items = await ctx.db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return items.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      circleId: n.circleId,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt?.toISOString() ?? null,
    }));
  });

  app.post("/api/me/notifications/read", async (req) => {
    const user = await requireUser(ctx, req);
    await ctx.db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
}

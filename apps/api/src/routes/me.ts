import type { FastifyInstance, FastifyRequest } from "fastify";
import {
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
import { checkImage, submitKyc, type Upload } from "../services/kyc.js";
import { meView, sendOtp, verifyOtp } from "../services/users.js";

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

  app.put("/api/me/promptpay", async (req) => {
    const user = await requireUser(ctx, req);
    const { promptPayId } = parse(promptPayBody, req.body);
    let normalized: string;
    try {
      normalized = parsePromptPayId(promptPayId).id;
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const updated = await ctx.db.user.update({ where: { id: user.id }, data: { promptPayId: normalized } });
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

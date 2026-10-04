import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "../src/context.js";
import { Encryptor } from "../src/crypto.js";
import { Prisma } from "../src/db.js";
import {
  anonymiseUser,
  DELETED_NAME,
  deletionBlockers,
  executeDueDeletions,
  type DeletionFacts,
} from "../src/services/privacy.js";

const enc = new Encryptor(Buffer.alloc(32, 7).toString("base64"));
const none: DeletionFacts = { activeCircles: 0, openCircles: 0, outstandingDefaults: 0, pendingRotation: false };

describe("deletion eligibility", () => {
  it("allows deletion when nobody relies on the user", () => {
    expect(deletionBlockers(none)).toEqual([]);
  });

  it("refuses while the user is in an unfinished circle", () => {
    const [reason] = deletionBlockers({ ...none, activeCircles: 2 });
    expect(reason).toMatch(/วงแชร์ที่กำลังดำเนินอยู่ 2 วง/);
    expect(deletionBlockers({ ...none, openCircles: 1 })[0]).toMatch(/ยังเปิดรับสมาชิก 1 วง/);
  });

  it("refuses while defaults are unpaid", () => {
    expect(deletionBlockers({ ...none, outstandingDefaults: 3 })[0]).toMatch(/หนี้ผิดนัดค้างอยู่ 3 รายการ/);
  });

  it("lists every reason", () => {
    expect(deletionBlockers({ activeCircles: 1, openCircles: 1, outstandingDefaults: 1, pendingRotation: true })).toHaveLength(4);
  });
});

/** Minimal in-memory stand-in for the Prisma calls made by the privacy service. */
function fakeCtx(opts: { active?: number; open?: number; debts?: number; rotations?: number } = {}) {
  const calls: { model: string; op: string; args: any }[] = [];
  const record =
    (model: string, op: string, result: unknown = { count: 1 }) =>
    (args: unknown) => {
      calls.push({ model, op, args });
      return Promise.resolve(result);
    };
  const user = {
    id: "u1",
    displayName: "สมชาย ใจดี",
    lineUserId: "Uabc",
    phone: "0812345678",
    walletAddress: "0x00000000000000000000000000000000000000a1",
    deletedAt: null,
  };
  const request = { id: "d1", userId: "u1", status: "PENDING", executeAfter: new Date(0), user };
  const db = {
    kycSubmission: {
      findMany: record("kycSubmission", "findMany", [{ id: "k1", idCardKey: "kyc/u1/a", selfieKey: "kyc/u1/b" }]),
      updateMany: record("kycSubmission", "updateMany"),
    },
    otpChallenge: { deleteMany: record("otpChallenge", "deleteMany") },
    notification: { deleteMany: record("notification", "deleteMany"), create: record("notification", "create") },
    keyRotationRequest: {
      updateMany: record("keyRotationRequest", "updateMany"),
      count: record("keyRotationRequest", "count", opts.rotations ?? 0),
    },
    user: { update: record("user", "update") },
    membership: {
      findMany: record("membership", "findMany", [{ address: user.walletAddress }]),
      count: (args: any) => {
        calls.push({ model: "membership", op: "count", args });
        return Promise.resolve(args.where.circle.status === "ACTIVE" ? (opts.active ?? 0) : (opts.open ?? 0));
      },
    },
    debt: { count: record("debt", "count", opts.debts ?? 0) },
    deletionRequest: {
      findMany: record("deletionRequest", "findMany", [request]),
      update: record("deletionRequest", "update"),
    },
    adminAuditLog: { create: record("adminAuditLog", "create") },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const storage = { delete: vi.fn((key: string) => Promise.resolve(void calls.push({ model: "storage", op: "delete", args: key }))) };
  const ctx = {
    db,
    storage,
    enc,
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    config: { ACCOUNT_DELETION_DELAY_DAYS: 7 },
  } as unknown as Ctx;
  return { ctx, calls, storage };
}

describe("anonymisation", () => {
  it("deletes KYC files and replaces personal fields with tombstones", async () => {
    const { ctx, calls, storage } = fakeCtx();
    await anonymiseUser(ctx, "u1");

    expect(storage.delete.mock.calls.map((c) => c[0])).toEqual(["kyc/u1/a", "kyc/u1/b"]);
    // files are deleted before the database is changed, so a storage failure leaves the request retryable
    expect(calls.findIndex((c) => c.model === "storage")).toBeLessThan(calls.findIndex((c) => c.model === "user"));

    const userUpdate = calls.find((c) => c.model === "user" && c.op === "update")!.args;
    expect(userUpdate.where).toEqual({ id: "u1" });
    expect(userUpdate.data).toMatchObject({
      displayName: DELETED_NAME,
      pictureUrl: null,
      lineUserId: null,
      phone: null,
      phoneVerifiedAt: null,
      promptPayId: null,
      walletBackup: Prisma.DbNull,
      role: "USER",
      sessionVersion: { increment: 1 },
    });
    expect(userUpdate.data.deletedAt).toBeInstanceOf(Date);
    // the on-chain address stays: memberships and payments are evidence for the other members
    expect(userUpdate.data).not.toHaveProperty("walletAddress");

    const kyc = calls.find((c) => c.model === "kycSubmission" && c.op === "updateMany")!.args;
    expect(kyc.data).toMatchObject({ nationalIdHash: "deleted:u1", nationalIdLast4: "", idCardKey: "", selfieKey: "" });
    expect(enc.decryptString(kyc.data.fullNameEnc)).toBe(DELETED_NAME);

    expect(calls.some((c) => c.model === "otpChallenge" && c.op === "deleteMany")).toBe(true);
    expect(calls.some((c) => c.model === "notification" && c.op === "deleteMany")).toBe(true);
    expect(calls.find((c) => c.model === "keyRotationRequest" && c.op === "updateMany")!.args.data.status).toBe("CANCELLED");
    // never touches the chain-derived records
    expect(calls.some((c) => ["membership", "payment", "chainEvent", "slip"].includes(c.model) && c.op !== "findMany")).toBe(
      false,
    );
  });
});

describe("executeDueDeletions", () => {
  it("anonymises an eligible account and audits it", async () => {
    const { ctx, calls } = fakeCtx();
    expect(await executeDueDeletions(ctx)).toBe(1);
    expect(calls.some((c) => c.model === "user" && c.op === "update")).toBe(true);
    const done = calls.find((c) => c.model === "deletionRequest" && c.op === "update")!.args;
    expect(done.data.status).toBe("COMPLETED");
    const audits = calls.filter((c) => c.model === "adminAuditLog").map((c) => c.args.data);
    expect(audits).toEqual([expect.objectContaining({ adminId: "system", action: "account.deletion.complete", targetId: "u1" })]);
  });

  it("refuses when the user joined a circle or defaulted during the cooling-off period", async () => {
    const { ctx, calls, storage } = fakeCtx({ active: 1, debts: 1 });
    expect(await executeDueDeletions(ctx)).toBe(0);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(calls.some((c) => c.model === "user" && c.op === "update")).toBe(false);
    const refused = calls.find((c) => c.model === "deletionRequest" && c.op === "update")!.args;
    expect(refused.data.status).toBe("REFUSED");
    expect(refused.data.reason).toMatch(/กำลังดำเนินอยู่/);
    expect(refused.data.reason).toMatch(/หนี้ผิดนัด/);
    const notice = calls.find((c) => c.model === "notification" && c.op === "create")!.args.data;
    expect(notice).toMatchObject({ userId: "u1", title: "ลบบัญชีไม่ได้ในตอนนี้" });
  });
});

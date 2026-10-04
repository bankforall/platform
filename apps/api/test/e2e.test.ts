/**
 * End-to-end: real Postgres, Redis, MinIO and an anvil chain with the deployed contracts
 * (see docker-compose.dev.yml + scripts/dev-deploy.sh). Plays a full Float circle through the
 * HTTP API, signing every action like the browser does, and drives time with evm_increaseTime.
 *
 *   pnpm --filter @bankforall/api test:e2e
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  bidHash,
  CircleType,
  CONSENT_VERSION,
  forwardRequestTypes,
  keyRotationMessage,
  walletProofMessage,
  toTypedDataMessage,
  type CircleDetail,
  type IntentResponse,
  type PreparedIntent,
} from "@bankforall/shared";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { toHex } from "viem";
import { randomBytes, randomInt } from "node:crypto";
import { Redis } from "ioredis";
import { buildApp, CSRF_HEADER, CSRF_VALUE } from "../src/app.js";
import { createChain } from "../src/chain/clients.js";
import { createDb } from "../src/db.js";
import { buildSignerApp } from "../src/signer/app.js";
import { executeDueRotations } from "../src/services/rotation.js";
import { loadConfig } from "../src/config.js";
import { closeCtx, createCtx, type Ctx } from "../src/context.js";
import { createLogger } from "../src/logger.js";
import { indexRange } from "../src/services/ingest.js";
import { runKeeper } from "../src/services/keeper.js";

const DAY = 86400;
let ctx: Ctx;
let app: FastifyInstance;
const sms: { phone: string; text: string }[] = [];
const run = Math.random().toString(36).slice(2, 7);

class Client {
  cookie = "";
  account: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());
  constructor(readonly name: string) {}

  async req<T = unknown>(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
    const isBuffer = Buffer.isBuffer(body);
    const res = await app.inject({
      method: method as "GET",
      url,
      headers: {
        cookie: this.cookie,
        [CSRF_HEADER]: CSRF_VALUE,
        ...(body !== undefined && !isBuffer ? { "content-type": "application/json" } : {}),
        ...extra,
      },
      payload: isBuffer ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers["set-cookie"];
    if (setCookie) this.cookie = String(setCookie).split(";")[0]!;
    const data = res.headers["content-type"]?.includes("json") ? res.json() : res.body;
    if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${JSON.stringify(data)}`);
    return data as T;
  }

  multipart<T>(url: string, fields: Record<string, string>, files: Record<string, Buffer>) {
    const boundary = "----bfa" + randomBytes(8).toString("hex");
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    for (const [k, v] of Object.entries(files)) {
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${k}.png"\r\nContent-Type: image/png\r\n\r\n`),
        v,
        Buffer.from("\r\n"),
      );
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return this.req<T>("POST", url, Buffer.concat(parts), { "content-type": `multipart/form-data; boundary=${boundary}` });
  }

  /** Signs and submits a prepared intent exactly like the web app. */
  async sign(prepared: PreparedIntent, extra: Record<string, unknown> = {}): Promise<IntentResponse> {
    const t = prepared.typedData;
    const signature = await this.account.signTypedData({
      domain: t.domain as never,
      types: forwardRequestTypes,
      primaryType: "ForwardRequest",
      message: toTypedDataMessage(t.message),
    });
    const res = await this.req<IntentResponse>("POST", `/api/intents/${prepared.id}/submit`, { signature, ...extra });
    if (res.status !== "CONFIRMED") throw new Error(`${prepared.kind} failed: ${res.error}`);
    return res;
  }

  async onboard(phone: string) {
    await this.req("POST", "/api/auth/dev-login", { displayName: `${this.name}-${run}` });
    await this.req("POST", "/api/me/phone/otp", { phone });
    const code = sms.at(-1)!.text.match(/\d{6}/)![0];
    await this.req("POST", "/api/me/phone/verify", { code });
    await this.req("PUT", "/api/me/promptpay", { promptPayId: phone });
    await this.req("POST", "/api/me/consent", { version: CONSENT_VERSION });
    await this.registerWallet();
    await this.multipart(
      "/api/me/kyc",
      { fullName: `${this.name} Tester`, nationalId: nationalId() },
      { idCard: png("id-card"), selfie: png("selfie") },
    );
  }

  async id() {
    return (await this.req<{ id: string }>("GET", "/api/me")).id;
  }

  /** Registers the device key with proof of possession (backup is opaque to the server). */
  async registerWallet() {
    const proof = await this.account.signMessage({ message: walletProofMessage(await this.id(), this.account.address) });
    await this.req("PUT", "/api/me/wallet", {
      address: this.account.address,
      proof,
      backup: { v: 1, salt: "c2FsdA==", iv: "aXY=", ciphertext: "Y2lwaGVy" },
    });
  }
}

/** Minimal PNG-signed buffer (uploads are checked by content, not MIME type). */
const png = (label: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label.padEnd(16, "."))]);

function nationalId(): string {
  const d = Array.from({ length: 12 }, (_, i) => (i === 0 ? randomInt(1, 9) : randomInt(0, 10)));
  const sum = d.reduce((s, x, i) => s + x * (13 - i), 0);
  return d.join("") + ((11 - (sum % 11)) % 10);
}

const phone = () => "08" + String(randomInt(10_000_000, 100_000_000));

async function warp(seconds: number) {
  const rpc = (method: string, params: unknown[]) =>
    fetch(ctx.config.RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine", []);
}

const host = new Client("host");
const alice = new Client("alice");
const bob = new Client("bob");
const admin = new Client("admin");
const admin2 = new Client("admin2");
let circle: CircleDetail;

const detail = async (c: Client = host) => (circle = await c.req<CircleDetail>("GET", `/api/circles/${circle.id}`));
const round = (n: number) => circle.rounds.find((r) => r.number === n)!;

let signerApp: FastifyInstance;

beforeAll(async () => {
  // the real signer service over HTTP (as in production), holding the attester key
  const signerConfig = loadConfig("signer", { ...process.env, SIGNER_TOKEN: "e2e-signer-token-0123456789abcdef" });
  const signerRedis = new Redis(signerConfig.REDIS_URL);
  signerApp = buildSignerApp({
    config: signerConfig,
    db: createDb(signerConfig.DATABASE_URL),
    chain: createChain(signerConfig, signerRedis),
  });
  signerApp.addHook("onClose", async () => signerRedis.disconnect());
  const signerUrl = await signerApp.listen({ host: "127.0.0.1", port: 0 });

  const config = loadConfig("api", {
    ...process.env,
    SIGNER_URL: signerUrl,
    SIGNER_TOKEN: signerConfig.SIGNER_TOKEN,
    KEY_ROTATION_DELAY_HOURS: "0",
  });
  ctx = createCtx(config, createLogger("e2e"));
  ctx.log.level = process.env.E2E_LOG ? "error" : "warn";
  ctx.sms = { send: async (p, text) => void sms.push({ phone: p, text }) };
  await ctx.storage.ensureBucket();
  app = await buildApp(ctx, { logger: !!process.env.E2E_LOG });
});

afterAll(async () => {
  await app?.close();
  await signerApp?.close();
  if (ctx) await closeCtx(ctx);
});

describe("full Float circle through the API", () => {
  it("onboards three members and an admin approves KYC", async () => {
    for (const c of [host, alice, bob]) await c.onboard(phone());
    for (const a of [admin, admin2]) {
      await a.req("POST", "/api/auth/dev-login", { displayName: `${a.name}-${run}` });
      await ctx.db.user.update({ where: { id: await a.id() }, data: { role: "ADMIN" } });
    }

    const pending = await admin.req<{ id: string; displayName: string; nationalIdLast4: string }[]>("GET", "/api/admin/kyc");
    for (const c of [host, alice, bob]) {
      const item = pending.find((p) => p.displayName === `${c.name}-${run}`)!;
      expect(item.nationalIdLast4).toMatch(/^\d{4}$/);
      const reputation = c === alice ? 300 : 100; // alice wins ties
      await admin.req("POST", `/api/admin/kyc/${item.id}/decision`, { approve: true, reputation });
    }
    const me = await host.req<{ onboarding: string[]; kycStatus: string }>("GET", "/api/me");
    expect(me.onboarding).toEqual([]);
    expect(me.kycStatus).toBe("APPROVED");
  });

  it("rejects requests without the CSRF header and unauthenticated reads", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: host.cookie } });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
  });

  it("host creates a private Float circle", async () => {
    const prepared = await host.req<PreparedIntent>("POST", "/api/circles", {
      name: `วงทดสอบ ${run}`,
      type: CircleType.Float,
      principal: "100000",
      maxMembers: 3,
      hostTakesFirst: true,
      period: 30 * DAY,
      bidWindow: DAY,
      revealWindow: DAY,
      paymentWindow: 3 * DAY,
      grace: DAY,
      private: true,
    });
    expect(prepared.summary).toContain("1,000.00");
    const result = await host.sign(prepared);
    circle = { id: result.circleId! } as CircleDetail;
    await detail();
    expect(circle.status).toBe("OPEN");
    expect(circle.address).toMatch(/^0x/);
    expect(circle.members).toHaveLength(1);
    expect(circle.inviteCode).toHaveLength(8);
  });

  it("members join with the invite code; wrong code is refused", async () => {
    await expect(alice.req("POST", `/api/circles/${circle.id}/join`, { inviteCode: "WRONG123" })).rejects.toThrow(/403/);
    const found = await alice.req<{ id: string }>("GET", `/api/circles/invite/${circle.inviteCode}`);
    expect(found.id).toBe(circle.id);
    for (const c of [alice, bob]) {
      await c.sign(await c.req<PreparedIntent>("POST", `/api/circles/${circle.id}/join`, { inviteCode: circle.inviteCode }));
    }
    await host.sign(await host.req<PreparedIntent>("POST", `/api/circles/${circle.id}/start`));
    await detail();
    expect(circle.status).toBe("ACTIVE");
    expect(round(1).recipient).toBe(host.account.address.toLowerCase()); // มือนายวง
    expect(round(1).payments.map((p) => p.amount)).toEqual(["100000", "100000"]);
  });

  it("round 1: members pay the host via PromptPay + slip; a wrong declaration is rejected; host confirms", async () => {
    const qr = await alice.req<{ payload: string; amount: string }>("GET", `/api/circles/${circle.id}/promptpay`);
    expect(qr.payload).toMatch(/^000201010212.*5303764.*54071000\.00.*6304[0-9A-F]{4}$/);
    expect(qr.amount).toBe("100000");

    // uploads are checked by content: a text file named .png is refused
    await expect(
      alice.multipart(`/api/circles/${circle.id}/payments`, {}, { slip: Buffer.from("not really an image") }),
    ).rejects.toThrow(/400/);

    for (const c of [alice, bob]) {
      await c.sign(await c.multipart<PreparedIntent>(`/api/circles/${circle.id}/payments`, {}, { slip: png(`slip-${c.name}`) }));
    }
    await detail();
    expect(round(1).payments.every((p) => p.status === "DECLARED" && p.slipId)).toBe(true);

    // the recipient can see a payer's slip; another payer cannot
    const slipId = round(1).payments.find((p) => p.payer === alice.account.address.toLowerCase())!.slipId!;
    await expect(host.req<string>("GET", `/api/slips/${slipId}`)).resolves.toContain("slip-alice");
    await expect(bob.req("GET", `/api/slips/${slipId}`)).rejects.toThrow(/403/);

    // only the recipient can confirm or reject
    await expect(
      alice.req("POST", `/api/circles/${circle.id}/payments/${bob.account.address}/confirm`).then((p) => alice.sign(p as PreparedIntent)),
    ).rejects.toThrow();
    // the money from bob did not arrive: the host rejects, bob declares again
    await host.sign(await host.req<PreparedIntent>("POST", `/api/circles/${circle.id}/payments/${bob.account.address}/reject`));
    await detail();
    expect(round(1).payments.find((p) => p.payer === bob.account.address.toLowerCase())!.status).toBe("NONE");
    expect((await bob.req<{ kind: string }[]>("GET", "/api/me/notifications")).map((n) => n.kind)).toContain(
      "payment_rejected",
    );
    await bob.sign(await bob.multipart<PreparedIntent>(`/api/circles/${circle.id}/payments`, {}, { slip: png("slip-bob-2") }));

    for (const c of [alice, bob]) {
      await host.sign(await host.req<PreparedIntent>("POST", `/api/circles/${circle.id}/payments/${c.account.address}/confirm`));
    }
    await detail();
    expect(round(1).payments.every((p) => p.status === "CONFIRMED")).toBe(true);
  });

  it("round 2: sealed bids are revealed by the keeper; the highest bid wins", async () => {
    await warp(30 * DAY);
    await runKeeper(ctx); // nextRound
    await detail();
    expect(circle.currentRound).toBe(2);
    expect(round(2).bidding).toBe(true);

    const bids: [Client, bigint][] = [
      [alice, 5_000n],
      [bob, 3_000n],
    ];
    for (const [c, amount] of bids) {
      const salt = toHex(randomBytes(32));
      const hash = bidHash(circle.address as `0x${string}`, 2, c.account.address, amount, salt);
      const prepared = await c.req<PreparedIntent>("POST", `/api/circles/${circle.id}/bids`, { hash });
      // a mismatching secret is refused before relaying
      await expect(c.sign(prepared, { bid: { amount: "1", salt } })).rejects.toThrow(/400/);
      const again = await c.req<PreparedIntent>("POST", `/api/circles/${circle.id}/bids`, { hash });
      await c.sign(again, { bid: { amount: amount.toString(), salt } });
    }
    await detail();
    expect(round(2).committed).toHaveLength(2);
    expect(round(2).revealed).toHaveLength(0); // amounts stay hidden

    await warp(DAY);
    await runKeeper(ctx); // reveals
    await warp(DAY);
    await runKeeper(ctx); // closeBidding
    await detail();
    expect(round(2).revealed).toHaveLength(2);
    expect(round(2).recipient).toBe(alice.account.address.toLowerCase());
    expect(round(2).winningBid).toBe("5000");
    // Float: host (won round 1 with bid 0) pays principal + 0; bob has not won → principal
    expect(Object.fromEntries(round(2).payments.map((p) => [p.payerName.split("-")[0], p.amount]))).toEqual({
      host: "100000",
      bob: "100000",
    });
  });

  it("the recipient cannot redirect payments mid-round; PromptPay changes need a fresh OTP", async () => {
    // alice receives round 2: changing where people pay her is refused until the round settles
    await expect(alice.req("PUT", "/api/me/promptpay", { promptPayId: "0899999999" })).rejects.toThrow(/RECIPIENT_LOCKED/);
    // the host may change it, but only with a step-up code sent to the verified phone
    await expect(host.req("PUT", "/api/me/promptpay", { promptPayId: "0899999998" })).rejects.toThrow(/STEP_UP_REQUIRED/);
    const { devCode } = await host.req<{ devCode: string }>("POST", "/api/me/step-up/otp");
    await expect(host.req("PUT", "/api/me/promptpay", { promptPayId: "0899999998", code: "000000" })).rejects.toThrow(/OTP_INVALID/);
    await host.req("PUT", "/api/me/promptpay", { promptPayId: "0899999998", code: devCode });
    expect((await host.req<{ promptPayId: string }>("GET", "/api/me")).promptPayId).toBe("0899999998");
  });

  it("a silent recipient cannot default an honest payer; a payer who never declares is defaulted", async () => {
    // host declares and alice (the recipient) never answers; bob never declares
    await host.sign(await host.multipart<PreparedIntent>(`/api/circles/${circle.id}/payments`, {}, { slip: png("slip-host-2") }));
    await warp(3 * DAY + DAY + 60); // past the default time
    await runKeeper(ctx);
    await detail();
    const byName = () => Object.fromEntries(round(2).payments.map((p) => [p.payerName.split("-")[0], p.status]));
    expect(byName()).toEqual({ host: "DECLARED", bob: "DEFAULTED" });

    await warp(DAY); // past the recipient's reject window → the declaration is accepted
    await runKeeper(ctx);
    await detail();
    expect(byName()).toEqual({ host: "CONFIRMED", bob: "DEFAULTED" });
    expect(circle.members.find((m) => m.address === bob.account.address.toLowerCase())!.defaulted).toBe(true);
    expect(circle.members.find((m) => m.address === host.account.address.toLowerCase())!.defaulted).toBe(false);

    const bobMe = await bob.req<{ reputation: number }>("GET", "/api/me");
    expect(bobMe.reputation).toBe(100 + 2 - 40); // one confirmed payment, one default
    const notes = await alice.req<{ kind: string }[]>("GET", "/api/me/notifications");
    expect(notes.map((n) => n.kind)).toContain("you_receive");
  });

  it("bob loses his phone: key rotation needs his new key's proof and two different admins", async () => {
    await warp(30 * DAY);
    await runKeeper(ctx);
    await detail();
    expect(circle.currentRound).toBe(3);
    expect(round(3).recipient).toBe(bob.account.address.toLowerCase());

    const bobId = await bob.id();
    const newKey = privateKeyToAccount(generatePrivateKey());
    // a proof signed by a different key is refused
    const wrongProof = await bob.account.signMessage({ message: keyRotationMessage(bobId, newKey.address) });
    await expect(bob.req("POST", "/api/me/key-rotation", { newAddress: newKey.address, proof: wrongProof })).rejects.toThrow(/BAD_PROOF/);
    const proof = await newKey.signMessage({ message: keyRotationMessage(bobId, newKey.address) });
    const me = await bob.req<{ pendingKeyRotation: { id: string; approvals: number } }>("POST", "/api/me/key-rotation", {
      newAddress: newKey.address,
      proof,
    });
    const requestId = me.pendingKeyRotation.id;

    await admin.req("POST", `/api/admin/key-rotations/${requestId}/approve`);
    await expect(admin.req("POST", `/api/admin/key-rotations/${requestId}/approve`)).rejects.toThrow(/409/); // same admin twice
    await executeDueRotations(ctx); // not approved yet → nothing happens
    expect((await ctx.db.keyRotationRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("PENDING");
    const approved = await admin2.req<{ status: string }>("POST", `/api/admin/key-rotations/${requestId}/approve`);
    expect(approved.status).toBe("APPROVED");

    await executeDueRotations(ctx); // delay is 0 in this test (24h in production)
    expect((await ctx.db.keyRotationRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("EXECUTED");
    // the old sessions were revoked; bob signs in again on the new phone with the new key
    await expect(bob.req("GET", "/api/me")).rejects.toThrow(/401/);
    bob.account = newKey;
    await bob.req("POST", "/api/auth/dev-login", { displayName: `bob-${run}` });
    expect((await bob.req<{ walletAddress: string }>("GET", "/api/me")).walletAddress).toBe(newKey.address.toLowerCase());
    await bob.registerWallet(); // upload the new backup with proof
    await detail();
    expect(round(3).recipient).toBe(newKey.address.toLowerCase());
    expect(circle.members.some((m) => m.address === newKey.address.toLowerCase())).toBe(true);
  });

  it("round 3: the last member receives with the new key; the circle completes", async () => {
    // Float dues in the final round: host principal + 0, alice principal + her 5,000 bid
    const dues = Object.fromEntries(round(3).payments.map((p) => [p.payerName.split("-")[0], p.amount]));
    expect(dues).toEqual({ host: "100000", alice: "105000" });

    for (const c of [host, alice]) {
      await c.sign(await c.multipart<PreparedIntent>(`/api/circles/${circle.id}/payments`, {}, { slip: png(`slip-${c.name}-3`) }));
      await bob.sign(await bob.req<PreparedIntent>("POST", `/api/circles/${circle.id}/payments/${c.account.address}/confirm`));
    }
    await warp(30 * DAY);
    await runKeeper(ctx);
    await detail();
    expect(circle.status).toBe("COMPLETED");
  });

  it("produces an evidence report and stays consistent when the indexer replays the chain", async () => {
    const html = await alice.req<string>("GET", `/api/circles/${circle.id}/evidence`);
    expect(html).toContain("รายงานหลักฐาน");
    expect(html).toContain("MemberDefaulted");
    expect(html).toContain("ผิดนัด");

    const before = await ctx.db.chainEvent.count({ where: { address: circle.address! } });
    await ctx.db.chainCursor.deleteMany({}); // replay from the deployment block
    for (let i = 0; i < 50; i++) if (!(await indexRange(ctx))) break;
    expect(await ctx.db.chainEvent.count({ where: { address: circle.address! } })).toBe(before);
    const after = await host.req<CircleDetail>("GET", `/api/circles/${circle.id}`);
    expect(after.rounds.map((r) => r.payments.map((p) => p.status))).toEqual(circle.rounds.map((r) => r.payments.map((p) => p.status)));
  });
});

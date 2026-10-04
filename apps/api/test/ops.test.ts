import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alert, redact, redactText, type AlertCtx } from "../src/alert.js";
import { configWarnings, loadConfig } from "../src/config.js";
import { FailureTracker } from "../src/ops.js";
import { maskedIdMatches, SlipOkVerifier, SlipProviderError } from "../src/providers/slip.js";
import { normalizeThaiMobile, ThaiBulkSms } from "../src/providers/sms.js";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const call = (i: number) => fetchMock.mock.calls[i] as [string, any];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeRedis() {
  const keys = new Map<string, string>();
  return {
    keys,
    set: vi.fn(async (k: string, v: string, ..._args: unknown[]) => {
      if (keys.has(k)) return null;
      keys.set(k, v);
      return "OK";
    }),
  };
}
const fakeLog = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });

function alertCtx(over: Partial<AlertCtx["config"]> = {}) {
  const redis = fakeRedis();
  const log = fakeLog();
  const ctx = {
    config: {
      ROLE: "worker",
      NODE_ENV: "production",
      PUBLIC_URL: "https://app.example.co.th",
      ALERT_WEBHOOK_URL: "https://hooks.example.com/T/abc",
      ALERT_WEBHOOK_FORMAT: "json",
      ALERT_LINE_TO: "",
      ALERT_THROTTLE_MINUTES: 30,
      LINE_MESSAGING_TOKEN: "",
      ...over,
    },
    log,
    redis,
  } as unknown as AlertCtx;
  return { ctx, redis, log };
}

describe("alert", () => {
  it("logs, posts once per key within the throttle window, and never throws", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    const { ctx, log, redis } = alertCtx();
    expect(await alert(ctx, "gas-low:keeper", "keeper gas balance low", { balance: "1" })).toBe(true);
    expect(await alert(ctx, "gas-low:keeper", "keeper gas balance low", { balance: "1" })).toBe(false);
    expect(await alert(ctx, "gas-low:relayer", "relayer gas balance low")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(3); // every occurrence is still logged
    expect(log.error.mock.calls[0]![1]).toBe("ALERT: keeper gas balance low");
    expect(redis.set).toHaveBeenCalledWith("alert:gas-low:keeper", "1", "EX", 1800, "NX");
    const body = JSON.parse(call(0)[1].body);
    expect(body).toMatchObject({ key: "gas-low:keeper", role: "worker", message: "keeper gas balance low", detail: { balance: "1" } });

    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(alert(ctx, "other", "x")).resolves.toBe(false);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ alert: "other" }), "alert delivery failed");
  });

  it("formats for Slack and Discord and pushes to a LINE group", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    const slack = alertCtx({ ALERT_WEBHOOK_FORMAT: "slack" });
    await alert(slack.ctx, "k", "hello");
    expect(JSON.parse(call(0)[1].body).text).toContain("hello");

    fetchMock.mockClear();
    const discord = alertCtx({ ALERT_WEBHOOK_FORMAT: "discord", ALERT_LINE_TO: "Cgroup", LINE_MESSAGING_TOKEN: "tok" });
    await alert(discord.ctx, "k", "hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(call(0)[1].body).content).toContain("hello");
    const [lineUrl, lineInit] = call(1);
    expect(lineUrl).toBe("https://api.line.me/v2/bot/message/push");
    expect(lineInit.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(lineInit.body).to).toBe("Cgroup");
  });

  it("does nothing off-box without a channel, and fails open when Redis is down", async () => {
    const none = alertCtx({ ALERT_WEBHOOK_URL: "" });
    expect(await alert(none.ctx, "k", "m")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(none.log.error).toHaveBeenCalled();

    fetchMock.mockResolvedValue(new Response("ok"));
    const down = alertCtx();
    down.redis.set.mockRejectedValue(new Error("redis down"));
    expect(await alert(down.ctx, "k", "m")).toBe(true);
  });

  it("redacts secrets and PII from what leaves the server", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    const { ctx } = alertCtx({ ALERT_WEBHOOK_FORMAT: "slack" });
    const pk = "0x" + "ab".repeat(32);
    await alert(ctx, "k", "boom", {
      phone: "0812345678",
      nationalId: "1101700230705",
      privateKey: pk,
      err: new Error(`user 081-234-5678 / +66812345678 id 1 1017 00230 70 5 key ${pk} at redis://:hunter2@redis:6379`),
      circle: "0x" + "1".repeat(40),
      round: 3,
    });
    const text: string = JSON.parse(call(0)[1].body).text;
    for (const leak of ["0812345678", "081-234-5678", "+66812345678", "1101700230705", "1 1017 00230 70 5", "ab".repeat(32), "hunter2"]) {
      expect(text).not.toContain(leak);
    }
    expect(text).toContain("0x" + "1".repeat(40)); // addresses are public and useful
    expect(text).toContain('"round":3');
  });

  it("redact keeps structure and drops sensitive keys", () => {
    expect(redact({ a: { SIGNER_TOKEN: "x", ok: "fine" }, list: ["0899999999"] })).toEqual({
      a: { SIGNER_TOKEN: "[redacted]", ok: "fine" },
      list: ["[redacted-phone]"],
    });
    expect(redactText("https://x.example/hook?token=abc&y=1")).toBe("https://x.example/hook?token=[redacted]&y=1");
    expect(redactText("block 12345678")).toBe("block 12345678");
  });

  it("FailureTracker alerts every N consecutive failures and resets on success", () => {
    const t = new FailureTracker(3);
    expect([t.failed("index"), t.failed("index"), t.failed("index")]).toEqual([false, false, true]);
    t.succeeded("index");
    expect(t.failed("index")).toBe(false);
    expect(t.count("index")).toBe(1);
  });
});

describe("ThaiBulkSMS", () => {
  const sms = new ThaiBulkSms({
    THAIBULKSMS_API_KEY: "KEY123",
    THAIBULKSMS_API_SECRET: "SECRET456",
    THAIBULKSMS_SENDER: "BankForAll",
    THAIBULKSMS_FORCE: "corporate",
  });

  it("normalises Thai mobile numbers", () => {
    expect(normalizeThaiMobile("0812345678")).toBe("0812345678");
    expect(normalizeThaiMobile("081-234-5678")).toBe("0812345678");
    expect(normalizeThaiMobile("+66812345678")).toBe("0812345678");
    expect(normalizeThaiMobile("66 81 234 5678")).toBe("0812345678");
    expect(() => normalizeThaiMobile("021234567")).toThrow("not a Thai mobile number");
    expect(() => normalizeThaiMobile("12345")).not.toThrow(/12345/);
  });

  it("posts the documented form with basic auth", async () => {
    fetchMock.mockResolvedValue(
      json(201, { remaining_credit: 10, phone_number_list: [{ number: "66812345678", message_id: "x", used_credit: 1 }], bad_phone_number_list: [] }),
    );
    await sms.send("+66812345678", "รหัส 123456");
    const [url, init] = call(0);
    expect(url).toBe("https://api-v2.thaibulksms.com/sms");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("KEY123:SECRET456").toString("base64"));
    const form = new URLSearchParams(init.body);
    expect(Object.fromEntries(form)).toEqual({ msisdn: "0812345678", message: "รหัส 123456", sender: "BankForAll", force: "corporate" });
  });

  it("throws without leaking secrets, the number or the OTP", async () => {
    const check = async (p: Promise<void>, pattern: RegExp) => {
      const err = await p.then(() => null, (e: Error) => e);
      expect(err?.message).toMatch(pattern);
      for (const leak of ["KEY123", "SECRET456", "0812345678", "123456", "S0VZ"]) expect(err!.message).not.toContain(leak);
    };
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 112, name: "ERROR_MESSAGE", description: "The message is invalid." } }));
    await check(sms.send("0812345678", "รหัส 123456"), /ThaiBulkSMS responded 400 112 ERROR_MESSAGE/);
    fetchMock.mockResolvedValueOnce(json(201, { phone_number_list: [], bad_phone_number_list: [{ number: "0812345678", message: "bad" }] }));
    await check(sms.send("0812345678", "รหัส 123456"), /rejected the phone number/);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed https://KEY123:SECRET456@x"));
    await check(sms.send("0812345678", "รหัส 123456"), /request failed: TypeError/);
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    await check(sms.send("0812345678", "รหัส 123456"), /responded 502/);
  });
});

describe("SlipOK", () => {
  const v = new SlipOkVerifier({ SLIPOK_BRANCH_ID: "12345", SLIPOK_API_KEY: "SLIPOK-KEY" });
  const input = { image: Buffer.from([0xff, 0xd8, 0xff, 1, 2]), contentType: "image/jpeg", expectedAmount: 150_050n, receiverPromptPayId: "0861230000" };
  const ok = (over: Record<string, unknown> = {}) =>
    json(200, {
      success: true,
      data: {
        success: true,
        transRef: "010092101507665143",
        transTimestamp: "2020-04-01T03:15:07.000Z",
        receiver: { displayName: "ธนาทร ร", proxy: { type: "MSISDN", value: "086xxx0000" }, account: { type: "BANKAC", value: "xxx-x-x3109-x" } },
        amount: 1500.5,
        ...over,
      },
    });

  it("matches masked PromptPay ids by their visible digits", () => {
    expect(maskedIdMatches("086xxx0000", "0861230000")).toBe(true);
    expect(maskedIdMatches("086-xxx-0000", "0861230000")).toBe(true);
    expect(maskedIdMatches("66xxxxx0000", "0861230000")).toBe(true);
    expect(maskedIdMatches("086xxx0001", "0861230000")).toBe(false);
    expect(maskedIdMatches("x-xxxx-xxxx0-70-5", "1101700230705")).toBe(true);
    expect(maskedIdMatches("x-xxxx-xxxx0-71-5", "1101700230705")).toBe(false);
    expect(maskedIdMatches("x-xxxx-xxxxx-70-5", "1101700230705")).toBeNull(); // fewer than 4 visible digits
    expect(maskedIdMatches("xxx-xxx-xxxx", "0861230000")).toBeNull();
  });

  it("sends only the image, the amount and log to the documented endpoint", async () => {
    fetchMock.mockResolvedValue(ok());
    const r = await v.verify(input);
    expect(r.status).toBe("VERIFIED");
    const [url, init] = call(0);
    expect(url).toBe("https://api.slipok.com/api/line/apikey/12345");
    expect(init.headers).toEqual({ "x-authorization": "SLIPOK-KEY" });
    const form = init.body as FormData;
    expect([...form.keys()].sort()).toEqual(["amount", "files", "log"]);
    expect(form.get("amount")).toBe("1500.50");
    expect(form.get("log")).toBe("true");
    expect((form.get("files") as File).size).toBe(5);
    expect(JSON.stringify(r.detail)).not.toContain("086"); // no receiver number stored
  });

  it("fails on wrong amount or receiver, skips when the receiver cannot be compared", async () => {
    fetchMock.mockResolvedValueOnce(ok({ amount: 1500 }));
    expect(await v.verify(input)).toMatchObject({ status: "FAILED", detail: { reason: "amount does not match" } });
    fetchMock.mockResolvedValueOnce(ok({ receiver: { proxy: { type: "MSISDN", value: "089xxx0000" } } }));
    expect(await v.verify(input)).toMatchObject({ status: "FAILED", detail: { reason: expect.stringContaining("receiver") } });
    fetchMock.mockResolvedValueOnce(ok({ receiver: { account: { type: "BANKAC", value: "xxx-x-x3109-x" } } }));
    expect((await v.verify(input)).status).toBe("SKIPPED");
  });

  it("maps slip faults to FAILED and provider faults to retryable errors", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { success: false, code: 1012, message: "สลิปซ้ำ สลิปนี้เคยส่งเข้ามาในระบบเมื่อ ..." }));
    expect(await v.verify(input)).toMatchObject({ status: "FAILED", detail: { code: 1012, reason: expect.stringContaining("duplicate") } });
    fetchMock.mockResolvedValueOnce(json(400, { success: false, code: 1007, message: "no QR" }));
    expect((await v.verify(input)).status).toBe("FAILED");

    fetchMock.mockResolvedValueOnce(json(400, { success: false, code: 1004, message: "quota" }));
    const quota = await v.verify(input).catch((e) => e);
    expect(quota).toBeInstanceOf(SlipProviderError);
    expect(quota.operator).toBe(true);
    expect(quota.message).not.toContain("SLIPOK-KEY");

    fetchMock.mockResolvedValueOnce(json(400, { success: false, code: 1010, message: "delay" }));
    const delay = await v.verify(input).catch((e) => e);
    expect(delay).toBeInstanceOf(SlipProviderError);
    expect(delay.operator).toBe(false);

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(v.verify(input)).rejects.toBeInstanceOf(SlipProviderError);
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 503 }));
    await expect(v.verify(input)).rejects.toThrow(/503/);
  });
});

describe("ops config", () => {
  const key = (n: number) => "0x" + n.toString(16).padStart(64, "0");
  const prod = {
    NODE_ENV: "production",
    PUBLIC_URL: "https://app.example.com",
    DATABASE_URL: "postgresql://x",
    REDIS_URL: "redis://x",
    SESSION_SECRET: "s".repeat(32),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    HMAC_KEY: "h".repeat(32),
    S3_BUCKET: "b",
    S3_ACCESS_KEY: "a",
    S3_SECRET_KEY: "s",
    CHAIN_ID: "8453",
    RPC_URL: "https://rpc.example.com",
    FACTORY_ADDRESS: "0x" + "1".repeat(40),
    FORWARDER_ADDRESS: "0x" + "2".repeat(40),
    LINE_CHANNEL_ID: "1",
    LINE_CHANNEL_SECRET: "2",
    SMS_PROVIDER: "twilio",
    SIGNER_URL: "http://signer:4100",
    SIGNER_TOKEN: "t".repeat(32),
  };

  it("requires provider credentials where they are used", () => {
    const api = { ...prod, RELAYER_PRIVATE_KEY: key(1), SMS_PROVIDER: "thaibulksms" };
    expect(() => loadConfig("api", api)).toThrow(/THAIBULKSMS_API_KEY: required when SMS_PROVIDER=thaibulksms/);
    expect(
      loadConfig("api", { ...api, THAIBULKSMS_API_KEY: "k", THAIBULKSMS_API_SECRET: "s", THAIBULKSMS_SENDER: "BankForAll" }).SMS_PROVIDER,
    ).toBe("thaibulksms");

    const worker = { ...prod, KEEPER_PRIVATE_KEY: key(2), SLIP_VERIFIER: "slipok" };
    expect(() => loadConfig("worker", worker)).toThrow(/SLIPOK_API_KEY: required/);
    expect(loadConfig("worker", { ...worker, SLIPOK_BRANCH_ID: "1", SLIPOK_API_KEY: "k" }).SLIP_VERIFIER).toBe("slipok");
    // the api does not verify slips, so it does not need (and should not get) the SlipOK key
    expect(loadConfig("api", { ...prod, RELAYER_PRIVATE_KEY: key(1), SLIP_VERIFIER: "slipok" }).ROLE).toBe("api");
    expect(() => loadConfig("worker", { ...prod, KEEPER_PRIVATE_KEY: key(2), ALERT_LINE_TO: "C1" })).toThrow(/LINE_MESSAGING_TOKEN/);
  });

  it("warns (does not fail) when production has no alert channel or heartbeat", () => {
    const worker = loadConfig("worker", { ...prod, KEEPER_PRIVATE_KEY: key(2) });
    expect(configWarnings(worker)).toHaveLength(2);
    const ready = loadConfig("worker", {
      ...prod,
      KEEPER_PRIVATE_KEY: key(2),
      ALERT_WEBHOOK_URL: "https://hooks.example.com/x",
      HEARTBEAT_URL: "https://hc-ping.com/uuid",
    });
    expect(configWarnings(ready)).toEqual([]);
  });
});

describe("slip verification retries", () => {
  async function run(verifyAttempts: number, error: Error, max = 3) {
    const { runSlipVerification } = await import("../src/services/keeper.js");
    const updateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const { ctx: a, log, redis } = alertCtx();
    const ctx = {
      ...a,
      config: { ...a.config, SLIP_VERIFY_MAX_ATTEMPTS: max },
      log,
      redis,
      db: {
        slip: {
          findMany: vi.fn(async () => [
            { id: "s1", circleId: "c1", round: 1, payer: "0xp", storageKey: "k", contentType: "image/jpeg", verifyAttempts, circle: { address: "0xc" } },
          ]),
          updateMany,
          update: vi.fn(),
        },
        payment: { findUnique: vi.fn(async () => ({ amount: 100n, status: "DECLARED" })) },
        round: { findUnique: vi.fn(async () => ({ recipient: "0xr" })) },
        user: { findUnique: vi.fn(async () => ({ promptPayId: "0861230000" })) },
      },
      storage: { get: vi.fn(async () => Buffer.from("img")) },
      slipVerifier: { verify: vi.fn(async () => Promise.reject(error)) },
    };
    fetchMock.mockResolvedValue(new Response("ok"));
    await runSlipVerification(ctx as never);
    return updateMany.mock.calls.map((c) => c[0] as { where: object; data: Record<string, unknown> });
  }

  it("keeps the slip PENDING with a backoff on provider errors", async () => {
    const [arg] = await run(0, new SlipProviderError("SlipOK responded 500 code ?"));
    expect(arg!.where).toEqual({ id: "s1", verify: "PENDING" });
    expect(arg!.data.verifyAttempts).toBe(1);
    expect((arg!.data.verifyAfter as Date).getTime()).toBeGreaterThan(Date.now());
    expect(fetchMock).not.toHaveBeenCalled(); // transient: no alert yet
  });

  it("gives up after the maximum attempts: SKIPPED and an alert", async () => {
    const [arg] = await run(2, new SlipProviderError("SlipOK request failed: TimeoutError"));
    expect(arg!.data.verify).toBe("SKIPPED");
    expect(JSON.parse(call(0)[1].body).key).toBe("slip-verifier:gave-up");
  });

  it("alerts at once when the provider needs the operator", async () => {
    await run(0, new SlipProviderError("SlipOK responded 400 code 1004", true));
    expect(JSON.parse(call(0)[1].body).key).toBe("slip-verifier:config");
  });
});

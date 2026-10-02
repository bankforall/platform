import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { Encryptor, inviteCode, randomDigits } from "../src/crypto.js";
import { validNationalId } from "../src/services/kyc.js";
import { maskPromptPay } from "../src/services/users.js";

const key = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const base = {
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
  RELAYER_PRIVATE_KEY: key(1),
  KEEPER_PRIVATE_KEY: key(2),
  ATTESTER_PRIVATE_KEY: key(3),
};

describe("config", () => {
  it("accepts a development config", () => {
    expect(loadConfig({ ...base, NODE_ENV: "development", DEV_LOGIN: "true" }).DEV_LOGIN).toBe(true);
  });

  it("refuses unsafe production settings", () => {
    const prod = { ...base, NODE_ENV: "production" };
    expect(() => loadConfig({ ...prod, DEV_LOGIN: "true" })).toThrow(/DEV_LOGIN/);
    expect(() => loadConfig(prod)).toThrow(/LINE_CHANNEL_ID|SMS_PROVIDER/);
    const ok = { ...prod, LINE_CHANNEL_ID: "1", LINE_CHANNEL_SECRET: "2", SMS_PROVIDER: "twilio" };
    expect(loadConfig(ok).NODE_ENV).toBe("production");
    expect(() => loadConfig({ ...ok, KEEPER_PRIVATE_KEY: key(1) })).toThrow(/must differ/);
    expect(() => loadConfig({ ...ok, PUBLIC_URL: "http://app.example.com" })).toThrow(/https/);
  });
});

describe("crypto", () => {
  it("round-trips and authenticates ciphertexts", () => {
    const enc = new Encryptor(base.APP_ENCRYPTION_KEY);
    const blob = enc.encrypt(Buffer.from("สลิปโอนเงิน"));
    expect(enc.decrypt(blob).toString()).toBe("สลิปโอนเงิน");
    blob[blob.length - 1]! ^= 1;
    expect(() => enc.decrypt(blob)).toThrow();
    expect(enc.encryptString("x")).not.toBe(enc.encryptString("x")); // random IV
  });

  it("generates codes of the right shape", () => {
    expect(randomDigits(6)).toMatch(/^\d{6}$/);
    expect(inviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
});

describe("helpers", () => {
  it("validates Thai national ID checksums", () => {
    expect(validNationalId("1101700230708")).toBe(true);
    expect(validNationalId("1101700230709")).toBe(false);
    expect(validNationalId("123")).toBe(false);
  });

  it("masks PromptPay IDs", () => {
    expect(maskPromptPay("0812345678")).toBe("081xxx5678");
    expect(maskPromptPay("1234567890123")).toBe("123xxxxxx0123");
  });
});

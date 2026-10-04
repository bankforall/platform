import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { Encryptor, inviteCode, randomDigits } from "../src/crypto.js";
import { sniffImage, validNationalId } from "../src/services/kyc.js";
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
  const prod = {
    ...base,
    NODE_ENV: "production",
    LINE_CHANNEL_ID: "1",
    LINE_CHANNEL_SECRET: "2",
    SMS_PROVIDER: "twilio",
    SIGNER_URL: "http://signer:4100",
    SIGNER_TOKEN: "t".repeat(32),
    WEBAUTHN_RP_ID: "app.example.com",
    WEBAUTHN_ORIGIN: "https://app.example.com",
  };
  const only = (keys: Record<string, string>) => ({
    ...prod,
    RELAYER_PRIVATE_KEY: "",
    KEEPER_PRIVATE_KEY: "",
    ATTESTER_PRIVATE_KEY: "",
    ...keys,
  });

  it("accepts a development config with in-process signing", () => {
    expect(loadConfig("api", { ...base, NODE_ENV: "development", DEV_LOGIN: "true" }).DEV_LOGIN).toBe(true);
  });

  it("gives each production process only its own key", () => {
    expect(loadConfig("api", only({ RELAYER_PRIVATE_KEY: key(1) })).ROLE).toBe("api");
    expect(loadConfig("worker", only({ KEEPER_PRIVATE_KEY: key(2) })).ROLE).toBe("worker");
    expect(loadConfig("signer", only({ ATTESTER_PRIVATE_KEY: key(3) })).ROLE).toBe("signer");
    expect(() => loadConfig("api", only({ RELAYER_PRIVATE_KEY: key(1), ATTESTER_PRIVATE_KEY: key(3) }))).toThrow(
      /ATTESTER_PRIVATE_KEY: must not be given/,
    );
    expect(() => loadConfig("worker", only({ KEEPER_PRIVATE_KEY: key(2), RELAYER_PRIVATE_KEY: key(1) }))).toThrow(
      /least privilege/,
    );
    expect(() => loadConfig("api", only({}))).toThrow(/RELAYER_PRIVATE_KEY: required/);
  });

  it("refuses unsafe production settings", () => {
    const api = only({ RELAYER_PRIVATE_KEY: key(1) });
    expect(() => loadConfig("api", { ...api, DEV_LOGIN: "true" })).toThrow(/DEV_LOGIN/);
    expect(() => loadConfig("api", { ...api, SIGNER_URL: "" })).toThrow(/separate signer/);
    expect(() => loadConfig("api", { ...api, SMS_PROVIDER: "console" })).toThrow(/SMS_PROVIDER/);
    expect(() => loadConfig("api", { ...api, PUBLIC_URL: "http://app.example.com" })).toThrow(/https/);
    expect(() => loadConfig("signer", only({ ATTESTER_PRIVATE_KEY: key(3), SIGNER_TOKEN: "short" }))).toThrow(
      /SIGNER_TOKEN/,
    );
  });

  it("derives WebAuthn settings outside production and keeps admin passkeys optional there", () => {
    const dev = loadConfig("api", { ...base, NODE_ENV: "development", PUBLIC_URL: "http://localhost:5173" });
    expect(dev.WEBAUTHN_RP_ID).toBe("localhost");
    expect(dev.WEBAUTHN_ORIGIN).toBe("http://localhost:5173");
    expect(dev.ADMIN_PASSKEY_REQUIRED).toBe(false);
    expect(dev.ADMIN_STEPUP_TTL).toBe(900);
    expect(loadConfig("api", { ...base, NODE_ENV: "test", ADMIN_PASSKEY_REQUIRED: "true" }).ADMIN_PASSKEY_REQUIRED).toBe(true);
    expect(() =>
      loadConfig("api", { ...base, WEBAUTHN_RP_ID: "evil.com", WEBAUTHN_ORIGIN: "https://app.example.com" }),
    ).toThrow(/WEBAUTHN_RP_ID/);
  });

  it("requires explicit WebAuthn settings and admin passkeys in production", () => {
    const api = only({ RELAYER_PRIVATE_KEY: key(1) });
    const c = loadConfig("api", api);
    expect(c.ADMIN_PASSKEY_REQUIRED).toBe(true);
    expect(c.WEBAUTHN_RP_ID).toBe("app.example.com");
    // a parent domain is a valid RP ID
    expect(loadConfig("api", { ...api, WEBAUTHN_RP_ID: "example.com" }).WEBAUTHN_RP_ID).toBe("example.com");
    expect(() => loadConfig("api", { ...api, WEBAUTHN_RP_ID: "" })).toThrow(/WEBAUTHN_RP_ID: required/);
    expect(() => loadConfig("api", { ...api, WEBAUTHN_ORIGIN: "" })).toThrow(/WEBAUTHN_ORIGIN: required/);
    expect(() => loadConfig("api", { ...api, WEBAUTHN_ORIGIN: "http://app.example.com" })).toThrow(/https/);
    expect(() => loadConfig("api", { ...api, ADMIN_PASSKEY_REQUIRED: "false" })).toThrow(/ADMIN_PASSKEY_REQUIRED/);
    // only the api process uses them
    expect(loadConfig("worker", only({ KEEPER_PRIVATE_KEY: key(2), WEBAUTHN_RP_ID: "", WEBAUTHN_ORIGIN: "" })).ROLE).toBe(
      "worker",
    );
  });

  it("defaults the user-visible product name and privacy periods", () => {
    const c = loadConfig("api", { ...base, APP_NAME: "" });
    expect(c.APP_NAME).toBe("Bank For All");
    expect(c.ACCOUNT_DELETION_DELAY_DAYS).toBe(7);
    expect(loadConfig("api", { ...base, APP_NAME: " วงดี " }).APP_NAME).toBe("วงดี");
  });

  it("refuses reused keys", () => {
    expect(() => loadConfig("api", { ...base, KEEPER_PRIVATE_KEY: key(1) })).toThrow(/must differ/);
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

  it("detects image types from content, not the declared MIME type", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
    expect(sniffImage(png)).toBe("image/png");
    expect(sniffImage(jpeg)).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>....."))).toBeNull();
  });

  it("masks PromptPay IDs", () => {
    expect(maskPromptPay("0812345678")).toBe("081xxx5678");
    expect(maskPromptPay("1234567890123")).toBe("123xxxxxx0123");
  });
});

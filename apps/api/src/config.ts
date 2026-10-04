import { z } from "zod";

/**
 * Each process gets only the secrets it needs (least privilege):
 *   api    — relayer key (pays gas for user-signed requests); no attester or keeper key
 *   worker — keeper key (time-based actions); no relayer or attester key
 *   signer — attester key, reachable only on the internal network, policy-checks every signature
 * In development the api/worker may sign attestations in-process (no SIGNER_URL, ATTESTER key set).
 */
export type Role = "api" | "worker" | "signer";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");
const hexKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex private key");
const optionalKey = z.union([hexKey, z.literal("")]).default("").transform((v) => v || undefined);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  /** Public origin of the app (web + /api), e.g. https://app.bankforall.co.th */
  PUBLIC_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  SESSION_SECRET: z.string().default(""),
  /** 32 bytes, base64. Encrypts KYC files, slips and bid secrets at rest. */
  APP_ENCRYPTION_KEY: z.string().default(""),
  HMAC_KEY: z.string().default(""),

  LINE_CHANNEL_ID: z.string().default(""),
  LINE_CHANNEL_SECRET: z.string().default(""),
  LINE_MESSAGING_TOKEN: z.string().default(""),
  DEV_LOGIN: bool,

  SMS_PROVIDER: z.enum(["console", "twilio"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_FROM: z.string().default(""),

  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  S3_FORCE_PATH_STYLE: bool,

  CHAIN_ID: z.coerce.number().int(),
  RPC_URL: z.string().url(),
  FACTORY_ADDRESS: address,
  FORWARDER_ADDRESS: address,
  DEPLOY_BLOCK: z.coerce.bigint().default(0n),
  CONFIRMATIONS: z.coerce.number().int().min(0).default(2),
  EXPLORER_URL: z.string().default(""),
  RELAYER_PRIVATE_KEY: optionalKey,
  KEEPER_PRIVATE_KEY: optionalKey,
  ATTESTER_PRIVATE_KEY: optionalKey,

  /** Internal signer service (holds the attester key). Empty = sign in-process (development only). */
  SIGNER_URL: z.string().default(""),
  SIGNER_TOKEN: z.string().default(""),
  SIGNER_PORT: z.coerce.number().int().default(4100),

  /** Warn (health + logs) when a gas-paying account holds less than this. */
  MIN_GAS_BALANCE_WEI: z.coerce.bigint().default(3_000_000_000_000_000n),
  SLIP_VERIFIER: z.enum(["none"]).default("none"),
  /** Worker loop interval. */
  WORKER_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  /** Waiting time between the second admin approval and an account key switch. */
  KEY_ROTATION_DELAY_HOURS: z.coerce.number().min(0).default(24),
});

export type Config = z.infer<typeof schema> & { ROLE: Role };

type Issue = { path: string; message: string };

function validate(c: z.infer<typeof schema>, role: Role): Issue[] {
  const issues: Issue[] = [];
  const req = (key: keyof typeof c, why = "required") => {
    if (!c[key]) issues.push({ path: key, message: why });
  };
  const forbid = (key: keyof typeof c) => {
    if (c[key]) issues.push({ path: key, message: `must not be given to the ${role} process (least privilege)` });
  };
  const prod = c.NODE_ENV === "production";
  const localSigner = !c.SIGNER_URL;

  if (role !== "signer") {
    if (c.SESSION_SECRET.length < 32) issues.push({ path: "SESSION_SECRET", message: "at least 32 characters" });
    if (Buffer.from(c.APP_ENCRYPTION_KEY, "base64").length !== 32) {
      issues.push({ path: "APP_ENCRYPTION_KEY", message: "must be 32 bytes base64" });
    }
    if (c.HMAC_KEY.length < 32) issues.push({ path: "HMAC_KEY", message: "at least 32 characters" });
    for (const k of ["S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) req(k);
    if (localSigner) req("ATTESTER_PRIVATE_KEY", "required when SIGNER_URL is empty");
    else req("SIGNER_TOKEN");
  }
  if (role === "api") req("RELAYER_PRIVATE_KEY");
  if (role === "worker") req("KEEPER_PRIVATE_KEY");
  if (role === "signer") {
    req("ATTESTER_PRIVATE_KEY");
    if (c.SIGNER_TOKEN.length < 32) issues.push({ path: "SIGNER_TOKEN", message: "at least 32 characters" });
  }

  if (prod) {
    if (role !== "signer" && localSigner) {
      issues.push({ path: "SIGNER_URL", message: "production must use the separate signer service" });
    }
    if (role === "api") {
      forbid("KEEPER_PRIVATE_KEY");
      forbid("ATTESTER_PRIVATE_KEY");
      if (c.DEV_LOGIN) issues.push({ path: "DEV_LOGIN", message: "must be false in production" });
      if (!c.LINE_CHANNEL_ID || !c.LINE_CHANNEL_SECRET) {
        issues.push({ path: "LINE_CHANNEL_ID", message: "LINE Login is required in production" });
      }
      if (c.SMS_PROVIDER === "console") {
        issues.push({ path: "SMS_PROVIDER", message: "console SMS is not allowed in production" });
      }
    }
    if (role === "worker") {
      forbid("RELAYER_PRIVATE_KEY");
      forbid("ATTESTER_PRIVATE_KEY");
    }
    if (role === "signer") {
      forbid("RELAYER_PRIVATE_KEY");
      forbid("KEEPER_PRIVATE_KEY");
    }
    if (role !== "signer" && !c.PUBLIC_URL.startsWith("https://")) {
      issues.push({ path: "PUBLIC_URL", message: "must be https in production" });
    }
  }
  const keys = [c.RELAYER_PRIVATE_KEY, c.KEEPER_PRIVATE_KEY, c.ATTESTER_PRIVATE_KEY].filter(Boolean) as string[];
  if (new Set(keys.map((k) => k.toLowerCase())).size !== keys.length) {
    issues.push({ path: "RELAYER_PRIVATE_KEY", message: "relayer, keeper and attester keys must differ" });
  }
  return issues;
}

export function loadConfig(role: Role, env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  const issues: Issue[] = parsed.success
    ? validate(parsed.data, role)
    : parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  if (issues.length) {
    throw new Error(`Invalid configuration for ${role}:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
  }
  return { ...parsed.data!, ROLE: role };
}

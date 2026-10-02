import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");
const hexKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex private key");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(4000),
    /** Public origin of the app (web + /api), e.g. https://app.bankforall.co.th */
    PUBLIC_URL: z.string().url(),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    SESSION_SECRET: z.string().min(32),
    /** 32 bytes, base64. Encrypts KYC files, slips and bid secrets at rest. */
    APP_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes base64"),
    HMAC_KEY: z.string().min(32),

    LINE_CHANNEL_ID: z.string().default(""),
    LINE_CHANNEL_SECRET: z.string().default(""),
    LINE_MESSAGING_TOKEN: z.string().default(""),
    DEV_LOGIN: bool,

    SMS_PROVIDER: z.enum(["console", "twilio"]).default("console"),
    TWILIO_ACCOUNT_SID: z.string().default(""),
    TWILIO_AUTH_TOKEN: z.string().default(""),
    TWILIO_FROM: z.string().default(""),

    S3_ENDPOINT: z.string().default(""),
    S3_REGION: z.string().default("ap-southeast-1"),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool,

    CHAIN_ID: z.coerce.number().int(),
    RPC_URL: z.string().url(),
    FACTORY_ADDRESS: address,
    FORWARDER_ADDRESS: address,
    DEPLOY_BLOCK: z.coerce.bigint().default(0n),
    CONFIRMATIONS: z.coerce.number().int().min(0).default(2),
    EXPLORER_URL: z.string().default(""),
    RELAYER_PRIVATE_KEY: hexKey,
    KEEPER_PRIVATE_KEY: hexKey,
    ATTESTER_PRIVATE_KEY: hexKey,

    /** Warn (health + logs) when the relayer or keeper holds less gas money than this. */
    MIN_GAS_BALANCE_WEI: z.coerce.bigint().default(3_000_000_000_000_000n),
    SLIP_VERIFIER: z.enum(["none"]).default("none"),
    /** Worker loop interval. */
    WORKER_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV !== "production") return;
    if (c.DEV_LOGIN) ctx.addIssue({ code: "custom", path: ["DEV_LOGIN"], message: "must be false in production" });
    if (!c.LINE_CHANNEL_ID || !c.LINE_CHANNEL_SECRET) {
      ctx.addIssue({ code: "custom", path: ["LINE_CHANNEL_ID"], message: "LINE Login is required in production" });
    }
    if (c.SMS_PROVIDER === "console") {
      ctx.addIssue({ code: "custom", path: ["SMS_PROVIDER"], message: "console SMS is not allowed in production" });
    }
    if (!c.PUBLIC_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["PUBLIC_URL"], message: "must be https in production" });
    }
    const keys = [c.RELAYER_PRIVATE_KEY, c.KEEPER_PRIVATE_KEY, c.ATTESTER_PRIVATE_KEY].map((k) => k.toLowerCase());
    if (new Set(keys).size !== 3) {
      ctx.addIssue({ code: "custom", path: ["RELAYER_PRIVATE_KEY"], message: "relayer, keeper and attester keys must differ" });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

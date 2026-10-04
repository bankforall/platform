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

/** Production operations integrations (alerting, heartbeat, Thai SMS, slip verification). See docs/v2/deployment.md. */
const opsSchema = {
  ALERT_WEBHOOK_URL: z.union([z.string().url(), z.literal("")]).default(""),
  ALERT_WEBHOOK_FORMAT: z.enum(["slack", "discord", "json"]).default("json"),
  /** LINE group/user id that receives alerts (uses LINE_MESSAGING_TOKEN). */
  ALERT_LINE_TO: z.string().default(""),
  /** The same alert key is sent at most once per this window. */
  ALERT_THROTTLE_MINUTES: z.coerce.number().min(0).default(30),
  /** Alert after a worker job fails this many ticks in a row. */
  ALERT_JOB_FAILURES: z.coerce.number().int().min(1).default(5),
  /** Alert when the indexer is this many blocks behind the chain head (Base ≈ 2 s per block). */
  INDEXER_LAG_ALERT_BLOCKS: z.coerce.number().int().min(1).default(300),
  /** Pinged (GET) by the worker after each successful loop, e.g. a healthchecks.io / Uptime Kuma push URL. */
  HEARTBEAT_URL: z.union([z.string().url(), z.literal("")]).default(""),
  THAIBULKSMS_API_KEY: z.string().default(""),
  THAIBULKSMS_API_SECRET: z.string().default(""),
  THAIBULKSMS_SENDER: z.string().default(""),
  /** "standard" | "corporate" overrides the dashboard SMS type; empty = dashboard setting. */
  THAIBULKSMS_FORCE: z.enum(["", "standard", "corporate"]).default(""),
  SLIPOK_BRANCH_ID: z.string().default(""),
  SLIPOK_API_KEY: z.string().default(""),
  /** Provider/network errors tolerated per slip before it is marked SKIPPED (recipient confirms instead). */
  SLIP_VERIFY_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
};

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

  SMS_PROVIDER: z.enum(["console", "twilio", "thaibulksms"]).default("console"),
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
  SLIP_VERIFIER: z.enum(["none", "slipok"]).default("none"),
  /** Worker loop interval. */
  WORKER_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  /** Waiting time between the second admin approval and an account key switch. */
  KEY_ROTATION_DELAY_HOURS: z.coerce.number().min(0).default(24),
  ...opsSchema,

  /**
   * WebAuthn relying party for admin passkeys (second factor on top of LINE login).
   * RP ID = the site's hostname (e.g. app.bankforall.co.th); origin = scheme://host[:port] the browser shows.
   * Outside production both default to PUBLIC_URL; production must set them explicitly.
   */
  WEBAUTHN_RP_ID: z.string().default(""),
  WEBAUTHN_ORIGIN: z.string().default(""),
  WEBAUTHN_RP_NAME: z.string().min(1).default("Bank For All"),
  /** Admins must enrol a passkey and step up before admin actions. Default: true in production, false otherwise. */
  ADMIN_PASSKEY_REQUIRED: z
    .enum(["true", "false", "1", "0", ""])
    .default("")
    .transform((v) => (v === "" ? undefined : v === "true" || v === "1")),
  /** Seconds an admin session stays "admin-verified" after a passkey step-up. */
  ADMIN_STEPUP_TTL: z.coerce.number().int().min(60).max(3600).default(900),
});

type Parsed = z.infer<typeof schema>;
export type Config = Omit<Parsed, "ADMIN_PASSKEY_REQUIRED"> & { ADMIN_PASSKEY_REQUIRED: boolean; ROLE: Role };

type Issue = { path: string; message: string };

/** Fills the WebAuthn defaults derived from PUBLIC_URL (non-production only) and ADMIN_PASSKEY_REQUIRED. */
function resolve(c: Parsed): Omit<Config, "ROLE"> {
  const prod = c.NODE_ENV === "production";
  const pub = new URL(c.PUBLIC_URL);
  return {
    ...c,
    WEBAUTHN_RP_ID: c.WEBAUTHN_RP_ID || (prod ? "" : pub.hostname),
    WEBAUTHN_ORIGIN: c.WEBAUTHN_ORIGIN || (prod ? "" : pub.origin),
    ADMIN_PASSKEY_REQUIRED: c.ADMIN_PASSKEY_REQUIRED ?? prod,
  };
}

/** RP ID must be the origin's host or a registrable parent of it (WebAuthn §5.1.3). */
export function rpIdMatchesOrigin(rpId: string, origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return host === rpId || host.endsWith(`.${rpId}`);
}

function validate(c: Omit<Config, "ROLE">, role: Role): Issue[] {
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
      req("WEBAUTHN_RP_ID", "required in production (admin passkeys)");
      req("WEBAUTHN_ORIGIN", "required in production (admin passkeys)");
      if (c.WEBAUTHN_ORIGIN && !c.WEBAUTHN_ORIGIN.startsWith("https://")) {
        issues.push({ path: "WEBAUTHN_ORIGIN", message: "must be https in production" });
      }
      if (!c.ADMIN_PASSKEY_REQUIRED) {
        issues.push({ path: "ADMIN_PASSKEY_REQUIRED", message: "must be true in production (admin 2FA)" });
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
  // ops integrations: provider credentials are required only where they are used
  if (role === "api" && c.SMS_PROVIDER === "thaibulksms") {
    for (const k of ["THAIBULKSMS_API_KEY", "THAIBULKSMS_API_SECRET", "THAIBULKSMS_SENDER"] as const) req(k, "required when SMS_PROVIDER=thaibulksms");
  }
  if (role === "worker" && c.SLIP_VERIFIER === "slipok") {
    for (const k of ["SLIPOK_BRANCH_ID", "SLIPOK_API_KEY"] as const) req(k, "required when SLIP_VERIFIER=slipok");
  }
  if (c.ALERT_LINE_TO && role !== "signer" && !c.LINE_MESSAGING_TOKEN) req("LINE_MESSAGING_TOKEN", "required when ALERT_LINE_TO is set");
  if (role === "api" && c.WEBAUTHN_RP_ID && c.WEBAUTHN_ORIGIN && !rpIdMatchesOrigin(c.WEBAUTHN_RP_ID, c.WEBAUTHN_ORIGIN)) {
    issues.push({ path: "WEBAUTHN_RP_ID", message: "must be the WEBAUTHN_ORIGIN hostname or a parent domain of it" });
  }
  const keys = [c.RELAYER_PRIVATE_KEY, c.KEEPER_PRIVATE_KEY, c.ATTESTER_PRIVATE_KEY].filter(Boolean) as string[];
  if (new Set(keys.map((k) => k.toLowerCase())).size !== keys.length) {
    issues.push({ path: "RELAYER_PRIVATE_KEY", message: "relayer, keeper and attester keys must differ" });
  }
  return issues;
}

/** Non-fatal production findings, logged at startup (see docs/v2/deployment.md for why these warn instead of fail). */
export function configWarnings(c: Config): string[] {
  const w: string[] = [];
  if (c.NODE_ENV !== "production") return w;
  const lineAlerts = c.ROLE !== "signer" && c.ALERT_LINE_TO && c.LINE_MESSAGING_TOKEN;
  if (!c.ALERT_WEBHOOK_URL && !lineAlerts) w.push("no alert channel (ALERT_WEBHOOK_URL / ALERT_LINE_TO): ALERT: lines go to logs only");
  if (c.ROLE === "worker" && !c.HEARTBEAT_URL) w.push("HEARTBEAT_URL is empty: nobody is told if the worker stops");
  return w;
}

export function loadConfig(role: Role, env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  const resolved = parsed.success ? resolve(parsed.data) : undefined;
  const issues: Issue[] = resolved
    ? validate(resolved, role)
    : parsed.error!.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  if (issues.length) {
    throw new Error(`Invalid configuration for ${role}:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
  }
  return { ...resolved!, ROLE: role };
}

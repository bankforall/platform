import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { Config } from "./config.js";

/**
 * Operator alerts. `alert()` always writes an `ALERT:` log line (log shipping can match on it) and,
 * when configured, posts to a webhook (Slack / Discord / generic JSON) and/or a LINE group.
 *
 * - Deduplicated per key: the same key is sent at most once per ALERT_THROTTLE_MINUTES (Redis SET NX EX,
 *   shared by every process), so a failure repeating every worker tick does not flood the channel.
 * - Never throws: a broken alert channel is logged, it never breaks the job that raised the alert.
 * - Redacted: the detail sent off-box drops secret/PII fields and masks phone numbers, national IDs,
 *   private keys and URL credentials. Only operational facts (ids, addresses, counts, error text) leave.
 */
export interface AlertCtx {
  config: Pick<
    Config,
    | "ROLE"
    | "NODE_ENV"
    | "PUBLIC_URL"
    | "ALERT_WEBHOOK_URL"
    | "ALERT_WEBHOOK_FORMAT"
    | "ALERT_LINE_TO"
    | "ALERT_THROTTLE_MINUTES"
    | "LINE_MESSAGING_TOKEN"
  >;
  log: FastifyBaseLogger;
  redis: Pick<Redis, "set">;
}

const SECRET_KEY =
  /(key|secret|token|password|passphrase|authorization|cookie|signature|salt|mnemonic|seed|otp|phone|msisdn|national|promptpay|fullname|enc$)/i;

/** Masks values that must never leave the server, in free text (error messages, URLs). */
export function redactText(text: string): string {
  return text
    .replace(/\b0x[0-9a-fA-F]{64}\b/g, "0x[redacted-32B]") // private keys / secrets (tx hashes too: harmless loss)
    .replace(/(\w+:\/\/)[^\s/@]*:[^\s/@]*@/g, "$1[redacted]@") // URL credentials
    .replace(/([?&](?:key|token|secret|apikey|api_key|access_token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(?<![0-9A-Za-z])\d[\d -]{11,15}\d(?![0-9A-Za-z])/g, (m) => (m.replace(/\D/g, "").length === 13 ? "[redacted-id]" : m)) // national ID (any 13 digits)
    .replace(/(?<![0-9A-Za-z])(?:\+?66|0)[689]\d{8}(?![0-9A-Za-z])/g, "[redacted-phone]")
    .replace(/(?<![0-9A-Za-z])0[689]\d-\d{3}-\d{4}(?![0-9A-Za-z])/g, "[redacted-phone]");
}

/** Deep copy of `value` that is safe to send to a third-party alert channel. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[…]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value).slice(0, 1000);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return { name: value.name, message: redactText(value.message).slice(0, 500), ...(code ? { code: String(code) } : {}) };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function render(ctx: AlertCtx, key: string, message: string, detail: unknown) {
  const where = `${ctx.config.ROLE}${ctx.config.NODE_ENV === "production" ? "" : `/${ctx.config.NODE_ENV}`}`;
  const site = (() => {
    try {
      return new URL(ctx.config.PUBLIC_URL).host;
    } catch {
      return "";
    }
  })();
  const head = `🚨 [bankforall ${site} ${where}] ${message}`;
  const json = detail === undefined ? "" : JSON.stringify(detail);
  const text = json && json !== "{}" ? `${head}\n${json.slice(0, 1500)}` : head;
  return { text, body: { service: "bankforall", site, role: ctx.config.ROLE, key, message, detail, at: new Date().toISOString() } };
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`alert channel responded ${res.status}`);
}

/**
 * Logs an `ALERT:` line and notifies the configured channels (deduplicated per `key`).
 * Resolves to whether a notification was sent; never rejects.
 */
export async function alert(ctx: AlertCtx, key: string, message: string, detail?: Record<string, unknown>): Promise<boolean> {
  // the local log keeps the full detail (pino redacts its own paths); only the copy sent off-box is redacted
  ctx.log.error({ ...detail, alert: key }, `ALERT: ${message}`);
  const c = ctx.config;
  const lineTo = c.ROLE !== "signer" && c.ALERT_LINE_TO && c.LINE_MESSAGING_TOKEN ? c.ALERT_LINE_TO : "";
  if (!c.ALERT_WEBHOOK_URL && !lineTo) return false;
  try {
    if (c.ALERT_THROTTLE_MINUTES > 0) {
      const ttl = Math.max(1, Math.round(c.ALERT_THROTTLE_MINUTES * 60));
      const first = await ctx.redis.set(`alert:${key}`, "1", "EX", ttl, "NX").catch(() => "OK"); // Redis down: fail open
      if (first === null) return false;
    }
    const { text, body } = render(ctx, key, message, redact(detail));
    const sends: Promise<void>[] = [];
    if (c.ALERT_WEBHOOK_URL) {
      const payload =
        c.ALERT_WEBHOOK_FORMAT === "slack"
          ? { text }
          : c.ALERT_WEBHOOK_FORMAT === "discord"
            ? { content: text.slice(0, 2000), allowed_mentions: { parse: [] } }
            : body;
      sends.push(post(c.ALERT_WEBHOOK_URL, payload));
    }
    if (lineTo) {
      sends.push(
        post(
          "https://api.line.me/v2/bot/message/push",
          { to: lineTo, messages: [{ type: "text", text: text.slice(0, 5000) }] },
          { authorization: `Bearer ${c.LINE_MESSAGING_TOKEN}` },
        ),
      );
    }
    const results = await Promise.allSettled(sends);
    const failed = results.filter((r) => r.status === "rejected");
    for (const f of failed) {
      ctx.log.warn({ alert: key, err: redactText(String((f as PromiseRejectedResult).reason?.message ?? f)) }, "alert delivery failed");
    }
    return failed.length < results.length;
  } catch (err) {
    ctx.log.warn({ alert: key, err: redactText(String((err as Error)?.message ?? err)) }, "alert delivery failed");
    return false;
  }
}

import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.js";

export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Development only: prints the message to the log. Rejected in production by config validation. */
class ConsoleSms implements SmsSender {
  constructor(private readonly log: FastifyBaseLogger) {}
  async send(phone: string, text: string) {
    this.log.warn({ phone, text }, "SMS (console provider)");
  }
}

class TwilioSms implements SmsSender {
  constructor(private readonly config: Config) {}

  async send(phone: string, text: string) {
    const to = "+66" + phone.replace(/^0/, "");
    const auth = Buffer.from(`${this.config.TWILIO_ACCOUNT_SID}:${this.config.TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: this.config.TWILIO_FROM, Body: text }),
      },
    );
    if (!res.ok) throw new Error(`Twilio responded ${res.status}: ${await res.text()}`);
  }
}

/** 0812345678 / 081-234-5678 / +66812345678 / 66812345678 → 0812345678. Throws (without echoing the number) otherwise. */
export function normalizeThaiMobile(phone: string): string {
  const digits = phone.replace(/[\s()+-]/g, "");
  const local = /^66\d{9}$/.test(digits) ? "0" + digits.slice(2) : digits;
  if (!/^0[689]\d{8}$/.test(local)) throw new Error("not a Thai mobile number");
  return local;
}

/**
 * ThaiBulkSMS API v2: POST https://api-v2.thaibulksms.com/sms, HTTP Basic (API key : API secret),
 * form fields msisdn / message / sender (+ optional force = standard|corporate).
 * Success: 200/201 JSON { remaining_credit, phone_number_list[], bad_phone_number_list[] }.
 * Error: JSON { error: { code, name, description } }. (API v2 manual on assets.thaibulksms.com, checked 2026-10.)
 * Thrown errors carry only the HTTP status and the provider's error code/name: never the number,
 * the message text (it holds the OTP) or the credentials.
 */
export class ThaiBulkSms implements SmsSender {
  constructor(
    private readonly config: Pick<Config, "THAIBULKSMS_API_KEY" | "THAIBULKSMS_API_SECRET" | "THAIBULKSMS_SENDER" | "THAIBULKSMS_FORCE">,
  ) {}

  async send(phone: string, text: string) {
    const msisdn = normalizeThaiMobile(phone);
    const c = this.config;
    const auth = Buffer.from(`${c.THAIBULKSMS_API_KEY}:${c.THAIBULKSMS_API_SECRET}`).toString("base64");
    const form = new URLSearchParams({ msisdn, message: text, sender: c.THAIBULKSMS_SENDER });
    if (c.THAIBULKSMS_FORCE) form.set("force", c.THAIBULKSMS_FORCE);
    let res: Response;
    try {
      res = await fetch("https://api-v2.thaibulksms.com/sms", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`ThaiBulkSMS request failed: ${(err as Error).name}`);
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: unknown; name?: unknown };
      bad_phone_number_list?: unknown[];
      phone_number_list?: unknown[];
    };
    if (!res.ok || body.error) {
      const code = body.error ? ` ${String(body.error.code ?? "")} ${String(body.error.name ?? "")}`.trimEnd() : "";
      throw new Error(`ThaiBulkSMS responded ${res.status}${code}`);
    }
    if (body.bad_phone_number_list?.length || !body.phone_number_list?.length) {
      throw new Error("ThaiBulkSMS rejected the phone number");
    }
  }
}

export function createSms(config: Config, log: FastifyBaseLogger): SmsSender {
  switch (config.SMS_PROVIDER) {
    case "twilio":
      return new TwilioSms(config);
    case "thaibulksms":
      return new ThaiBulkSms(config);
    default:
      return new ConsoleSms(log);
  }
}

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

export function createSms(config: Config, log: FastifyBaseLogger): SmsSender {
  return config.SMS_PROVIDER === "twilio" ? new TwilioSms(config) : new ConsoleSms(log);
}

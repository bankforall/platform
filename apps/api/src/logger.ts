import pino from "pino";
import type { FastifyBaseLogger } from "fastify";

export function createLogger(name: string): FastifyBaseLogger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        'res.headers["set-cookie"]',
        "*.signature",
        "*.salt",
        "*.nationalId",
      ],
      censor: "[redacted]",
    },
    transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
  }) as unknown as FastifyBaseLogger;
}

import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import { createChain, type Chain } from "./chain/clients.js";
import type { Config } from "./config.js";
import { Encryptor } from "./crypto.js";
import { Line } from "./providers/line.js";
import { createSms, type SmsSender } from "./providers/sms.js";
import { createSlipVerifier, type SlipVerifier } from "./providers/slip.js";
import { Storage } from "./providers/storage.js";

/** Everything a route, service or worker job needs. Built once per process. */
export interface Ctx {
  config: Config;
  log: FastifyBaseLogger;
  db: PrismaClient;
  redis: Redis;
  enc: Encryptor;
  chain: Chain;
  storage: Storage;
  sms: SmsSender;
  line: Line;
  slipVerifier: SlipVerifier;
}

export function createCtx(config: Config, log: FastifyBaseLogger): Ctx {
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
  const enc = new Encryptor(config.APP_ENCRYPTION_KEY);
  return {
    config,
    log,
    db: new PrismaClient(),
    redis,
    enc,
    chain: createChain(config, redis),
    storage: new Storage(config, enc),
    sms: createSms(config, log),
    line: new Line(config),
    slipVerifier: createSlipVerifier(config),
  };
}

export async function closeCtx(ctx: Ctx) {
  await ctx.db.$disconnect();
  ctx.redis.disconnect();
}

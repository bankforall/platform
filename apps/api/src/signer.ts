import { Redis } from "ioredis";
import { createChain } from "./chain/clients.js";
import { alert } from "./alert.js";
import { configWarnings, loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createLogger } from "./logger.js";
import { buildSignerApp } from "./signer/app.js";
import type { SignerCtx } from "./signer/policy.js";

/**
 * Signer service: the only process holding the attester key. Runs on the internal network only
 * (no published port); see signer/app.ts for the API and signer/policy.ts for the rules.
 */
const config = loadConfig("signer");
const log = createLogger("signer");
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
const ctx: SignerCtx = { config, db: createDb(config.DATABASE_URL), chain: createChain(config, redis) };
const app = buildSignerApp(ctx, log);
for (const w of configWarnings(config)) log.warn(`config: ${w}`);

// the attester pays gas for attestSlip: flag low balance for /api/health
setInterval(async () => {
  try {
    const balance = await ctx.chain.publicClient.getBalance({ address: ctx.chain.attester!.address });
    if (balance < config.MIN_GAS_BALANCE_WEI) {
      await alert({ config, log, redis }, "gas-low:attester", "attester gas balance low — top up", {
        balance: balance.toString(),
        address: ctx.chain.attester!.address,
      });
      await redis.set("ops:gas-low:attester", String(balance), "PX", 10 * 60_000);
    } else {
      await redis.del("ops:gas-low:attester");
    }
  } catch (err) {
    log.warn({ err }, "gas check failed");
  }
}, 60_000).unref();

const shutdown = async () => {
  await app.close();
  await ctx.db.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

await app.listen({ host: "0.0.0.0", port: config.SIGNER_PORT });

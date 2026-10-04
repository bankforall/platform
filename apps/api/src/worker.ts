import { loadConfig } from "./config.js";
import { closeCtx, createCtx, type Ctx } from "./context.js";
import { createLogger } from "./logger.js";
import { indexRange } from "./services/ingest.js";
import { cleanup, reconcileIntents, runKeeper, runReminders, runSlipVerification } from "./services/keeper.js";
import { pushPending } from "./services/notify.js";
import { executeDueRotations } from "./services/rotation.js";
import { checkGas } from "./gas.js";

/**
 * Background worker: indexer, keeper, slip verification, reminders and LINE push.
 * Several replicas may run; a Redis lease makes exactly one of them active at a time.
 */
const config = loadConfig("worker");
const log = createLogger("worker");
const ctx = createCtx(config, log);
const LEASE_KEY = "lease:worker";
const LEASE_MS = 30_000;
const me = `${process.pid}-${Math.random().toString(36).slice(2)}`;
let running = true;

async function holdLease(ctx: Ctx): Promise<boolean> {
  const got = await ctx.redis.set(LEASE_KEY, me, "PX", LEASE_MS, "NX");
  if (got) return true;
  if ((await ctx.redis.get(LEASE_KEY)) === me) {
    await ctx.redis.pexpire(LEASE_KEY, LEASE_MS);
    return true;
  }
  return false;
}

const jobs: [string, (ctx: Ctx) => Promise<unknown>][] = [
  ["gas", (c) => checkGas(c, "keeper", c.chain.keeper)],
  ["index", async (c) => {
    // catch up in chunks within one tick
    for (let i = 0; i < 10; i++) if (!(await indexRange(c))) break;
  }],
  ["reconcile", reconcileIntents],
  ["keeper", runKeeper],
  ["slips", runSlipVerification],
  ["reminders", runReminders],
  ["push", pushPending],
  ["cleanup", cleanup],
  ["rotations", executeDueRotations],
];

async function tick() {
  if (!(await holdLease(ctx))) return;
  for (const [name, job] of jobs) {
    if (!running) return;
    const started = Date.now();
    try {
      await job(ctx);
    } catch (err) {
      log.error({ err, job: name }, "job failed");
    }
    const ms = Date.now() - started;
    if (ms > 10_000) log.warn({ job: name, ms }, "slow job");
  }
  await ctx.redis.set("worker:heartbeat", String(Date.now()), "PX", 5 * 60_000);
}

process.on("SIGTERM", () => (running = false));
process.on("SIGINT", () => (running = false));

await ctx.storage.ensureBucket();
log.info("worker started");
while (running) {
  await tick();
  await new Promise((r) => setTimeout(r, config.WORKER_INTERVAL_MS));
}
if ((await ctx.redis.get(LEASE_KEY)) === me) await ctx.redis.del(LEASE_KEY);
await closeCtx(ctx);
log.info("worker stopped");

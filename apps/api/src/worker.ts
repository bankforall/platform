import { alert } from "./alert.js";
import { configWarnings, loadConfig } from "./config.js";
import { closeCtx, createCtx, type Ctx } from "./context.js";
import { createLogger } from "./logger.js";
import { indexRange } from "./services/ingest.js";
import { cleanup, reconcileIntents, runKeeper, runReminders, runSlipVerification } from "./services/keeper.js";
import { pushPending } from "./services/notify.js";
import { executeDueRotations } from "./services/rotation.js";
import { executeDueDeletions, purgeExpiredSlips } from "./services/privacy.js";
import { checkGas } from "./gas.js";
import { checkIndexerLag, checkSigner, FailureTracker, heartbeat } from "./ops.js";

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
  ["lag", checkIndexerLag],
  ["signer", checkSigner],
  ["reconcile", reconcileIntents],
  ["keeper", runKeeper],
  ["slips", runSlipVerification],
  ["reminders", runReminders],
  ["push", pushPending],
  ["cleanup", cleanup],
  ["rotations", executeDueRotations],
  ["deletions", executeDueDeletions],
  ["slip-retention", purgeExpiredSlips],
];

const failures = new FailureTracker(config.ALERT_JOB_FAILURES);

async function tick() {
  if (!(await holdLease(ctx))) return;
  let allOk = true;
  for (const [name, job] of jobs) {
    if (!running) return;
    const started = Date.now();
    try {
      await job(ctx);
      failures.succeeded(name);
    } catch (err) {
      allOk = false;
      log.error({ err, job: name }, "job failed");
      if (failures.failed(name)) {
        await alert(ctx, `job:${name}`, `worker job "${name}" failed ${failures.count(name)} times in a row`, { job: name, err });
      }
    }
    const ms = Date.now() - started;
    if (ms > 10_000) log.warn({ job: name, ms }, "slow job");
  }
  await ctx.redis.set("worker:heartbeat", String(Date.now()), "PX", 5 * 60_000);
  if (allOk) await heartbeat(ctx);
}

process.on("SIGTERM", () => (running = false));
process.on("SIGINT", () => (running = false));

await ctx.storage.ensureBucket();
for (const w of configWarnings(config)) log.warn(`config: ${w}`);
log.info("worker started");
while (running) {
  try {
    await tick();
    failures.succeeded("tick");
  } catch (err) {
    // lease/Redis errors: keep the loop alive, the next tick retries
    log.error({ err }, "worker tick failed");
    if (failures.failed("tick")) await alert(ctx, "job:tick", "worker loop keeps failing (Redis?)", { err });
  }
  await new Promise((r) => setTimeout(r, config.WORKER_INTERVAL_MS));
}
if ((await ctx.redis.get(LEASE_KEY)) === me) await ctx.redis.del(LEASE_KEY);
await closeCtx(ctx);
log.info("worker stopped");

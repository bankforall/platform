import { buildApp } from "./app.js";
import { configWarnings, loadConfig } from "./config.js";
import { closeCtx, createCtx } from "./context.js";
import { checkGas } from "./gas.js";
import { createLogger } from "./logger.js";
import { checkSigner } from "./ops.js";

const config = loadConfig("api");
const log = createLogger("api");
const ctx = createCtx(config, log);
await ctx.storage.ensureBucket();
const app = await buildApp(ctx);
for (const w of configWarnings(config)) log.warn(`config: ${w}`);
const gasTimer = setInterval(() => {
  void checkGas(ctx, "relayer", ctx.chain.relayer).catch(() => {});
  void checkSigner(ctx);
}, 60_000);
gasTimer.unref();
void checkGas(ctx, "relayer", ctx.chain.relayer).catch(() => {});

const shutdown = async (signal: string) => {
  log.info({ signal }, "shutting down");
  await app.close();
  await closeCtx(ctx);
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: config.PORT });

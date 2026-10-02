import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { closeCtx, createCtx } from "./context.js";
import { createLogger } from "./logger.js";

const config = loadConfig();
const log = createLogger("api");
const ctx = createCtx(config, log);
await ctx.storage.ensureBucket();
const app = await buildApp(ctx);

const shutdown = async (signal: string) => {
  log.info({ signal }, "shutting down");
  await app.close();
  await closeCtx(ctx);
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: config.PORT });

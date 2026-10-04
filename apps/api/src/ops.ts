import { alert } from "./alert.js";
import type { Ctx } from "./context.js";

/** Alerts when the signer service (holds the attester key) cannot be reached from the api/worker. */
export async function checkSigner(ctx: Ctx): Promise<boolean> {
  if (!ctx.config.SIGNER_URL) return true; // in-process signer (development)
  try {
    const res = await fetch(new URL("/health", ctx.config.SIGNER_URL), { signal: AbortSignal.timeout(5_000) });
    if (res.ok) return true;
    await alert(ctx, "signer-unreachable", "signer service unhealthy — slip attestations, KYC statements and key rotations are blocked", {
      status: res.status,
    });
  } catch (err) {
    await alert(ctx, "signer-unreachable", "signer service unreachable — slip attestations, KYC statements and key rotations are blocked", {
      err,
    });
  }
  return false;
}

/** Alerts when the indexer cursor is more than INDEXER_LAG_ALERT_BLOCKS behind the chain head. */
export async function checkIndexerLag(ctx: Ctx): Promise<bigint> {
  const [head, cursor] = await Promise.all([
    ctx.chain.publicClient.getBlockNumber(),
    ctx.db.chainCursor.findUnique({ where: { id: "main" } }),
  ]);
  const at = cursor?.blockNumber ?? ctx.config.DEPLOY_BLOCK;
  const lag = head > at ? head - at : 0n;
  if (lag > BigInt(ctx.config.INDEXER_LAG_ALERT_BLOCKS)) {
    await alert(ctx, "indexer-lag", `indexer is ${lag} blocks behind the chain head — balances and statuses shown to users are stale`, {
      head: head.toString(),
      cursor: at.toString(),
      lag: lag.toString(),
    });
  }
  return lag;
}

/**
 * Counts consecutive failures per worker job and alerts once a job has failed `threshold` ticks in a row
 * (a single failed tick is normal: RPC hiccups, a busy database).
 */
export class FailureTracker {
  private readonly counts = new Map<string, number>();
  constructor(private readonly threshold: number) {}

  /** Returns true when this failure reaches the alert threshold (and every `threshold` failures after). */
  failed(job: string): boolean {
    const n = (this.counts.get(job) ?? 0) + 1;
    this.counts.set(job, n);
    return n % this.threshold === 0;
  }
  succeeded(job: string) {
    this.counts.delete(job);
  }
  count(job: string) {
    return this.counts.get(job) ?? 0;
  }
}

let lastBeat = 0;
/**
 * Pings HEARTBEAT_URL (healthchecks.io / Uptime Kuma "push" monitor) after a successful worker loop,
 * at most once a minute. The external service alerts when pings stop. Never throws.
 */
export async function heartbeat(ctx: Pick<Ctx, "config" | "log">, now = Date.now()): Promise<void> {
  if (!ctx.config.HEARTBEAT_URL || now - lastBeat < 60_000) return;
  lastBeat = now;
  try {
    const res = await fetch(ctx.config.HEARTBEAT_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) ctx.log.warn({ status: res.status }, "heartbeat ping rejected");
  } catch (err) {
    ctx.log.warn({ err: (err as Error).message }, "heartbeat ping failed");
  }
}

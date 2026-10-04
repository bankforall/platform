import { circleAbi, formatBaht } from "@bankforall/shared";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { need } from "../chain/clients.js";
import { contractErrorName } from "../chain/errors.js";
import type { Ctx } from "../context.js";
import { ingestLogs } from "./ingest.js";
import { notifyAddress } from "./notify.js";

/**
 * Moves circles forward on time. Every action here is permissionless on-chain (anyone may call
 * it once its time has come); the keeper simulates first and only sends calls that will succeed.
 */
export async function runKeeper(ctx: Ctx): Promise<number> {
  const circles = await ctx.db.circle.findMany({ where: { status: "ACTIVE", address: { not: null } } });
  const block = await ctx.chain.publicClient.getBlock({ blockTag: "latest" });
  const now = Number(block.timestamp);
  let sent = 0;
  for (const circle of circles) {
    try {
      sent += await tickCircle(ctx, getAddress(circle.address!), circle.id, now);
    } catch (err) {
      ctx.log.error({ err, circle: circle.id }, "keeper tick failed");
    }
  }
  return sent;
}

async function tickCircle(ctx: Ctx, address: Address, circleId: string, now: number): Promise<number> {
  const read = <T>(functionName: string, args: unknown[] = []) =>
    ctx.chain.publicClient.readContract({ address, abi: circleAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  const r = await read<number>("currentRound");
  const params = await read<{ maxMembers: number; period: bigint; grace: bigint }>("params");
  const [start, biddingEnds, revealEnds, paymentDeadline, bidding, decided, settled] = await read<
    [bigint, bigint, bigint, bigint, boolean, boolean, number, Address, bigint]
  >("rounds", [r]);
  let sent = 0;

  if (bidding && !decided) {
    if (now >= Number(biddingEnds) && now < Number(revealEnds)) {
      const secrets = await ctx.db.bidSecret.findMany({ where: { circleId, round: r, revealed: false } });
      for (const s of secrets) {
        const ok = await call(ctx, address, "revealBid", [
          getAddress(s.member),
          BigInt(ctx.enc.decryptString(s.amountEnc)),
          ctx.enc.decryptString(s.saltEnc) as Hex,
        ]);
        if (ok) sent++;
        else await ctx.db.bidSecret.update({ where: { id: s.id }, data: { revealed: true } }); // invalid; don't retry
      }
    } else if (now >= Number(revealEnds)) {
      const unrevealed = await ctx.db.bidSecret.count({ where: { circleId, round: r, committed: true, revealed: false } });
      if (unrevealed > 0) {
        // the reveal window passed without the keeper opening these bids (worker down?) — they are lost
        ctx.log.error({ circle: circleId, round: r, unrevealed }, "ALERT: sealed bids were never revealed");
      }
      if (await call(ctx, address, "closeBidding", [])) sent++;
    }
    return sent;
  }
  if (!decided) return sent;

  // only payers who never declared can be defaulted; declarations the recipient neither confirmed
  // nor rejected in time are accepted (stops a silent recipient from defaulting honest payers)
  const defaultAfter = Number(paymentDeadline) + Number(params.grace);
  const acceptAfter = Number(paymentDeadline) + 2 * Number(params.grace);
  if (now > defaultAfter) {
    const unpaid = await ctx.db.payment.findMany({ where: { circleId, round: r, status: "NONE" } });
    for (const p of unpaid) {
      if (await call(ctx, address, "markDefault", [getAddress(p.payer)])) sent++;
    }
  }
  if (now > acceptAfter) {
    const declared = await ctx.db.payment.findMany({ where: { circleId, round: r, status: "DECLARED" } });
    for (const p of declared) {
      if (await call(ctx, address, "acceptDeclared", [getAddress(p.payer)])) sent++;
    }
  }
  if (settled >= params.maxMembers - 1 && now >= Number(start) + Number(params.period)) {
    if (await call(ctx, address, "nextRound", [])) sent++;
  }
  return sent;
}

/** Simulates as the keeper and sends only if it would succeed. Returns whether it was mined. */
async function call(ctx: Ctx, address: Address, functionName: string, args: unknown[]): Promise<boolean> {
  const data = encodeFunctionData({ abi: circleAbi, functionName: functionName as never, args: args as never });
  try {
    const keeper = need(ctx.chain.keeper, "keeper key");
    await ctx.chain.publicClient.call({ account: keeper, to: address, data });
  } catch (err) {
    ctx.log.debug({ functionName, error: contractErrorName(err) }, "keeper call not ready");
    return false;
  }
  const hash = await ctx.chain.sender.send(need(ctx.chain.keeper, "keeper key"), { to: address, data });
  const receipt = await ctx.chain.sender.wait(hash);
  if (receipt.status !== "success") {
    ctx.log.error({ functionName, hash }, "keeper tx reverted");
    return false;
  }
  await ingestLogs(ctx, receipt.logs);
  ctx.log.info({ functionName, circle: address, hash }, "keeper tx");
  return true;
}

/** Verifies uploaded slips and records verified ones on-chain (attester). */
export async function runSlipVerification(ctx: Ctx): Promise<void> {
  const slips = await ctx.db.slip.findMany({ where: { verify: "PENDING" }, take: 20, include: { circle: true } });
  for (const slip of slips) {
    const payment = await ctx.db.payment.findUnique({
      where: { circleId_round_payer: { circleId: slip.circleId, round: slip.round, payer: slip.payer } },
    });
    const round = await ctx.db.round.findUnique({
      where: { circleId_number: { circleId: slip.circleId, number: slip.round } },
    });
    const recipient = round?.recipient
      ? await ctx.db.user.findUnique({ where: { walletAddress: round.recipient } })
      : null;
    if (!payment?.amount || !recipient?.promptPayId) {
      await ctx.db.slip.update({ where: { id: slip.id }, data: { verify: "SKIPPED", verifyDetail: { reason: "missing payment or recipient" } } });
      continue;
    }
    const image = await ctx.storage.get(slip.storageKey);
    const result = await ctx.slipVerifier.verify({
      image,
      contentType: slip.contentType,
      expectedAmount: payment.amount,
      receiverPromptPayId: recipient.promptPayId,
    });
    let attestTx: string | null = null;
    // the verdict is stored first: the signer re-checks it before attesting on-chain
    await ctx.db.slip.update({ where: { id: slip.id }, data: { verify: result.status, verifyDetail: result.detail as object } });
    if (result.status === "VERIFIED" && payment.status === "DECLARED" && slip.circle.address) {
      try {
        const hash = await ctx.signer.attestSlip(slip.id);
        const receipt = await ctx.chain.publicClient.getTransactionReceipt({ hash });
        await ingestLogs(ctx, receipt.logs);
        attestTx = hash;
      } catch (err) {
        ctx.log.error({ err, slip: slip.id }, "slip attestation failed");
      }
    }
    if (result.status === "FAILED") {
      await notifyAddress(ctx, slip.payer, {
        kind: "slip_failed",
        title: "ตรวจสอบสลิปไม่ผ่าน",
        body: `สลิปรอบที่ ${slip.round} ไม่ตรงกับยอด ${formatBaht(payment.amount)} บาท หรือบัญชีผู้รับ กรุณาตรวจสอบ`,
        circleId: slip.circleId,
      });
    }
    await ctx.db.slip.update({
      where: { id: slip.id },
      data: { verify: result.status, verifyDetail: result.detail as object, attestTx },
    });
  }
}

/** Payment reminders (D-2, D-0, overdue), de-duplicated per payment. */
export async function runReminders(ctx: Ctx): Promise<void> {
  const now = Date.now();
  const rounds = await ctx.db.round.findMany({
    where: { decided: true, paymentDeadline: { gt: new Date(now - 7 * 86400_000) }, circle: { status: "ACTIVE" } },
    include: { circle: true },
  });
  for (const r of rounds) {
    if (r.number !== r.circle.currentRound || !r.paymentDeadline) continue;
    const deadline = r.paymentDeadline.getTime();
    const stage = now > deadline ? "overdue" : deadline - now < 24 * 3600_000 ? "d0" : deadline - now < 48 * 3600_000 ? "d2" : null;
    if (!stage) continue;
    const unpaid = await ctx.db.payment.findMany({ where: { circleId: r.circleId, round: r.number, status: "NONE" } });
    for (const p of unpaid) {
      await notifyAddress(ctx, p.payer, {
        kind: "reminder",
        dedupeKey: `due:${r.circleId}:${r.number}:${p.payer}:${stage}`,
        title:
          stage === "overdue"
            ? `เลยกำหนดชำระรอบที่ ${r.number} แล้ว`
            : `อย่าลืมโอนรอบที่ ${r.number} (${stage === "d0" ? "ภายในวันนี้" : "อีก 2 วัน"})`,
        body: `${formatBaht(p.amount ?? 0n)} บาท — ครบกำหนด ${r.paymentDeadline.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}${stage === "overdue" ? " หากไม่ชำระภายในช่วงผ่อนผันจะถูกบันทึกว่าผิดนัด" : ""}`,
        circleId: r.circleId,
      });
    }
  }
}

/** Abandoned drafts (create was prepared but never signed) and expired intents. */
export async function cleanup(ctx: Ctx): Promise<void> {
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  await ctx.db.circle.updateMany({ where: { status: "DRAFT", createdTx: null, createdAt: { lt: dayAgo } }, data: { status: "FAILED" } });
  await ctx.db.txIntent.updateMany({ where: { status: "PREPARED", createdAt: { lt: dayAgo } }, data: { status: "EXPIRED" } });
}

/** Finalises intents whose HTTP request ended before the receipt arrived. */
export async function reconcileIntents(ctx: Ctx): Promise<void> {
  const stuck = await ctx.db.txIntent.findMany({
    where: { status: "SUBMITTED", txHash: { not: null }, updatedAt: { lt: new Date(Date.now() - 60_000) } },
    take: 20,
  });
  for (const i of stuck) {
    const receipt = await ctx.chain.publicClient
      .getTransactionReceipt({ hash: i.txHash as Hex })
      .catch(() => null);
    if (!receipt) continue;
    if (receipt.status === "success") await ingestLogs(ctx, receipt.logs);
    await ctx.db.txIntent.update({
      where: { id: i.id },
      data: receipt.status === "success" ? { status: "CONFIRMED" } : { status: "FAILED", error: "บันทึกรายการไม่สำเร็จ" },
    });
  }
}

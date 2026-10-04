import { Prisma, type PaymentStatus } from "../db.js";
import { amountDue, circleAbi, circleFactoryAbi, formatBaht, type CircleRules } from "@bankforall/shared";
import { parseEventLogs, type Log } from "viem";
import type { Ctx } from "../context.js";
import { notify, notifyAddress } from "./notify.js";
import { recomputeReputation } from "./reputation.js";

const abi = [...circleFactoryAbi, ...circleAbi];
const lower = (a: string) => a.toLowerCase();
const PAYMENT_RANK: Record<PaymentStatus, number> = { NONE: 0, DECLARED: 1, ATTESTED: 2, DEFAULTED: 3, CONFIRMED: 4 };

type Decoded = ReturnType<typeof parseEventLogs<typeof abi>>[number];

/** Mirrors Circle.owed: adds `delta` (may be negative) and never goes below zero. */
async function adjustDebt(tx: Prisma.TransactionClient, circleId: string, debtor: string, creditor: string, delta: bigint) {
  const key = { circleId_debtor_creditor: { circleId, debtor, creditor } };
  const current = (await tx.debt.findUnique({ where: key }))?.amount ?? 0n;
  const next = current + delta > 0n ? current + delta : 0n;
  await tx.debt.upsert({ where: key, create: { circleId, debtor, creditor, amount: next }, update: { amount: next } });
}

/**
 * Applies contract events to the database. Idempotent: every log is recorded once in ChainEvent
 * (unique txHash+logIndex) in the same transaction as its effects, so the receipt path (right
 * after relaying) and the indexer (catch-up) can both feed the same logs safely. Handlers use
 * upserts and status ranks so they also tolerate logs from different transactions arriving out of order.
 *
 * Only logs from the factory or from circles the factory created (known in the DB) are trusted.
 */
export async function ingestLogs(ctx: Ctx, logs: Log[]): Promise<number> {
  // Factory logs first: a new circle's own logs (e.g. the host's MemberJoined emitted during
  // initialize) precede CircleCreated in the same transaction, and need the circle to be known.
  const factory = lower(ctx.chain.factory);
  const decoded = parseEventLogs({ abi, logs, strict: true }).sort(
    (a, b) => Number(lower(b.address) === factory) - Number(lower(a.address) === factory),
  );
  const blockTimes = new Map<bigint, Date>();
  let applied = 0;

  for (const log of decoded) {
    const address = lower(log.address);
    let circleId: string | null = null;
    if (address !== factory) {
      const circle = await ctx.db.circle.findUnique({ where: { address }, select: { id: true } });
      if (!circle) continue; // not one of ours
      circleId = circle.id;
    }

    let blockTime = blockTimes.get(log.blockNumber!);
    if (!blockTime) {
      const block = await ctx.chain.publicClient.getBlock({ blockNumber: log.blockNumber! });
      blockTime = new Date(Number(block.timestamp) * 1000);
      blockTimes.set(log.blockNumber!, blockTime);
    }

    const followUps: (() => Promise<void>)[] = [];
    try {
      await ctx.db.$transaction(async (tx) => {
        await tx.chainEvent.create({
          data: {
            blockNumber: log.blockNumber!,
            blockTime,
            txHash: log.transactionHash!,
            logIndex: log.logIndex!,
            address,
            name: log.eventName,
            args: JSON.parse(JSON.stringify(log.args ?? {}, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
          },
        });
        await apply(ctx, tx, log, circleId, blockTime, followUps);
      });
      applied++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue; // already ingested
      // One bad event must not stop indexing for every circle: record it, alert, move on.
      ctx.log.error({ err, tx: log.transactionHash, logIndex: log.logIndex, event: log.eventName }, "ALERT: ingest failed");
      await ctx.db.ingestError
        .upsert({
          where: { txHash_logIndex: { txHash: log.transactionHash!, logIndex: log.logIndex! } },
          create: {
            txHash: log.transactionHash!,
            logIndex: log.logIndex!,
            address,
            name: log.eventName,
            error: String((err as Error).message ?? err).slice(0, 2000),
          },
          update: { error: String((err as Error).message ?? err).slice(0, 2000) },
        })
        .catch((e) => ctx.log.error({ err: e }, "could not record ingest error"));
      continue;
    }
    for (const f of followUps) {
      try {
        await f();
      } catch (err) {
        ctx.log.warn({ err }, "ingest follow-up failed");
      }
    }
  }
  return applied;
}

async function apply(
  ctx: Ctx,
  tx: Prisma.TransactionClient,
  log: Decoded,
  circleId: string | null,
  blockTime: Date,
  later: (() => Promise<void>)[],
) {
  switch (log.eventName) {
    case "CircleCreated": {
      const circle = await tx.circle.findUnique({ where: { createdTx: log.transactionHash! } });
      if (!circle) {
        ctx.log.warn({ circle: log.args.circle, tx: log.transactionHash }, "CircleCreated without a draft — ignored");
        return;
      }
      // policy snapshot taken by the contract at creation (decisions D2–D4)
      const contract = { address: log.args.circle, abi: circleAbi } as const;
      const [maxBid, trustedReputation, openUntil] = await Promise.all([
        ctx.chain.publicClient.readContract({ ...contract, functionName: "maxBid" }),
        ctx.chain.publicClient.readContract({ ...contract, functionName: "trustedReputation" }),
        ctx.chain.publicClient.readContract({ ...contract, functionName: "openUntil" }),
      ]);
      await tx.circle.update({
        where: { id: circle.id },
        data: {
          address: lower(log.args.circle),
          status: "OPEN",
          maxBid,
          trustedReputation,
          openUntil: new Date(Number(openUntil) * 1000),
        },
      });
      return;
    }
    case "MemberJoined": {
      const member = lower(log.args.member);
      const user = await tx.user.findUnique({ where: { walletAddress: member }, select: { id: true } });
      await tx.membership.upsert({
        where: { circleId_address: { circleId: circleId!, address: member } },
        create: {
          circleId: circleId!,
          address: member,
          userId: user?.id ?? null,
          index: log.args.index,
          seat: log.args.seat,
          reputation: log.args.reputation,
          joinedAt: blockTime,
        },
        update: {},
      });
      if (log.args.index > 0) {
        const circle = await tx.circle.findUniqueOrThrow({ where: { id: circleId! } });
        later.push(() =>
          notify(ctx, {
            userId: circle.hostId,
            kind: "member_joined",
            title: `มีสมาชิกใหม่ในวง "${circle.name}"`,
            body: `สมาชิกคนที่ ${log.args.index + 1}/${circle.maxMembers} เข้าร่วมแล้ว`,
            circleId: circle.id,
          }),
        );
      }
      return;
    }
    case "CircleStarted":
      await tx.circle.update({ where: { id: circleId! }, data: { status: "ACTIVE" } });
      return;
    case "CircleCancelled":
      await tx.circle.update({ where: { id: circleId! }, data: { status: "CANCELLED" } });
      return;
    case "CircleCompleted": {
      await tx.circle.update({ where: { id: circleId! }, data: { status: "COMPLETED" } });
      const members = await tx.membership.findMany({ where: { circleId: circleId!, userId: { not: null } } });
      for (const m of members) {
        later.push(() =>
          notify(ctx, {
            userId: m.userId!,
            kind: "circle_completed",
            title: "วงแชร์จบครบทุกรอบแล้ว 🎉",
            body: "ดาวน์โหลดรายงานหลักฐานของวงได้ที่หน้าวง",
            circleId: circleId!,
          }),
        );
      }
      return;
    }
    case "RoundOpened": {
      const round = log.args.round;
      const toDate = (s: bigint) => (s === 0n ? null : new Date(Number(s) * 1000));
      await tx.round.upsert({
        where: { circleId_number: { circleId: circleId!, number: round } },
        create: {
          circleId: circleId!,
          number: round,
          startedAt: blockTime,
          bidding: log.args.bidding,
          biddingEnds: toDate(log.args.biddingEnds),
          revealEnds: toDate(log.args.revealEnds),
        },
        update: {
          startedAt: blockTime,
          bidding: log.args.bidding,
          biddingEnds: toDate(log.args.biddingEnds),
          revealEnds: toDate(log.args.revealEnds),
        },
      });
      await tx.circle.updateMany({
        where: { id: circleId!, currentRound: { lt: round } },
        data: { currentRound: round },
      });
      if (log.args.bidding) {
        const members = await tx.membership.findMany({
          where: { circleId: circleId!, hasWon: false, defaulted: false, userId: { not: null } },
        });
        for (const m of members) {
          later.push(() =>
            notify(ctx, {
              userId: m.userId!,
              kind: "bidding_open",
              title: `เปิดประมูลรอบที่ ${round}`,
              body: "ยื่นซองประมูลได้แล้ว ระบบจะเปิดซองให้อัตโนมัติเมื่อถึงเวลา",
              circleId: circleId!,
            }),
          );
        }
      }
      return;
    }
    case "BidCommitted":
      await tx.bidSecret.updateMany({
        where: { circleId: circleId!, round: log.args.round, member: lower(log.args.member) },
        data: { committed: true },
      });
      return;
    case "BidRevealed":
      await tx.bidSecret.updateMany({
        where: { circleId: circleId!, round: log.args.round, member: lower(log.args.member) },
        data: { revealed: true },
      });
      return;
    case "RecipientSelected": {
      const r = log.args.round;
      const recipient = lower(log.args.recipient);
      await tx.round.update({
        where: { circleId_number: { circleId: circleId!, number: r } },
        data: {
          decided: true,
          recipient,
          winningBid: log.args.winningBid,
          paymentDeadline: new Date(Number(log.args.paymentDeadline) * 1000),
        },
      });
      await tx.membership.updateMany({
        where: { circleId: circleId!, address: recipient },
        data: { hasWon: true, wonRound: r, wonBid: log.args.winningBid },
      });
      const circle = await tx.circle.findUniqueOrThrow({ where: { id: circleId! } });
      const rules: CircleRules = {
        type: circle.type,
        principal: circle.principal,
        maxMembers: circle.maxMembers,
        hostTakesFirst: circle.hostTakesFirst,
        fixRateBps: circle.fixRateBps,
      };
      const members = await tx.membership.findMany({ where: { circleId: circleId! } });
      const recipientMember = members.find((m) => m.address === recipient);
      const recipientUser = recipientMember?.userId
        ? await tx.user.findUnique({ where: { id: recipientMember.userId } })
        : null;
      const deadline = new Date(Number(log.args.paymentDeadline) * 1000);
      for (const m of members) {
        if (m.address === recipient) continue;
        const wonBefore = m.wonRound !== null && m.wonRound < r ? m.wonBid : null;
        const due = amountDue(rules, m.seat, wonBefore, log.args.winningBid);
        await tx.payment.upsert({
          where: { circleId_round_payer: { circleId: circleId!, round: r, payer: m.address } },
          create: { circleId: circleId!, round: r, payer: m.address, amount: due },
          update: {},
        });
        if (m.userId) {
          later.push(() =>
            notify(ctx, {
              userId: m.userId!,
              kind: "payment_due",
              title: `รอบที่ ${r}: โอน ${formatBaht(due)} บาท`,
              body: `ให้ ${recipientUser?.displayName ?? "ผู้รับ"} ภายใน ${deadline.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`,
              circleId: circleId!,
            }),
          );
        }
      }
      if (recipientUser) {
        later.push(() =>
          notify(ctx, {
            userId: recipientUser.id,
            kind: "you_receive",
            title: `คุณเป็นผู้รับเงินรอบที่ ${r} 🎉`,
            body: "เมื่อได้รับเงินจากสมาชิกแต่ละคน กรุณากดยืนยันการรับเงินในแอป",
            circleId: circleId!,
          }),
        );
      }
      return;
    }
    case "PaymentOffset": {
      // set-off against the recipient's unpaid debt to this payer (decisions D1)
      const r = log.args.round;
      const payer = lower(log.args.payer);
      const remaining = log.args.remaining;
      await adjustDebt(tx, circleId!, lower(log.args.recipient), payer, -log.args.offset);
      const data = {
        amount: remaining,
        offset: log.args.offset,
        ...(remaining === 0n ? { status: "CONFIRMED" as const, txHash: log.transactionHash! } : {}),
      };
      await tx.payment.upsert({
        where: { circleId_round_payer: { circleId: circleId!, round: r, payer } },
        create: { circleId: circleId!, round: r, payer, ...data },
        update: data,
      });
      later.push(() =>
        notifyAddress(ctx, payer, {
          kind: "payment_offset",
          title: `หักกลบหนี้รอบที่ ${r} แล้ว`,
          body:
            remaining === 0n
              ? `ไม่ต้องโอน — หักกลบกับเงินที่ผู้รับค้างคุณ ${formatBaht(log.args.offset)} บาทครบแล้ว`
              : `หักกลบ ${formatBaht(log.args.offset)} บาท โอนเพิ่มอีก ${formatBaht(remaining)} บาท`,
          circleId: circleId!,
        }),
      );
      return;
    }
    case "PaymentRejected": {
      // the recipient says the money never arrived: back to unpaid (the only allowed downgrade)
      const r = log.args.round;
      const payer = lower(log.args.payer);
      await tx.payment.updateMany({
        where: { circleId: circleId!, round: r, payer, status: "DECLARED" },
        data: { status: "NONE", slipHash: null, slipId: null, txHash: log.transactionHash! },
      });
      later.push(() =>
        notifyAddress(ctx, payer, {
          kind: "payment_rejected",
          title: `ผู้รับแจ้งว่ายังไม่ได้รับเงินรอบที่ ${r}`,
          body: "ตรวจสอบการโอนอีกครั้ง แล้วแจ้งโอนใหม่ก่อนหมดเวลา หากโอนแล้วจริงให้แจ้งปัญหาในหน้าวง",
          circleId: circleId!,
        }),
      );
      return;
    }
    case "PaymentDeclared":
    case "SlipAttested":
    case "PaymentConfirmed":
    case "PaymentAccepted":
    case "MemberDefaulted": {
      const status: PaymentStatus = {
        PaymentDeclared: "DECLARED",
        SlipAttested: "ATTESTED",
        PaymentConfirmed: "CONFIRMED",
        PaymentAccepted: "CONFIRMED",
        MemberDefaulted: "DEFAULTED",
      }[log.eventName] as PaymentStatus;
      const r = log.args.round;
      const payer = lower(log.args.payer);
      const key = { circleId_round_payer: { circleId: circleId!, round: r, payer } };
      const current = await tx.payment.findUnique({ where: key });
      if (current && PAYMENT_RANK[current.status] >= PAYMENT_RANK[status]) return;
      if (log.eventName === "MemberDefaulted") {
        await adjustDebt(tx, circleId!, payer, lower(log.args.recipient), log.args.amount);
      }
      if (log.eventName === "PaymentConfirmed" && current?.status === "DEFAULTED") {
        await adjustDebt(tx, circleId!, payer, lower(log.args.recipient), -log.args.amount);
      }
      const data: Prisma.PaymentUncheckedUpdateInput = { status, txHash: log.transactionHash! };
      if (log.eventName === "MemberDefaulted") data.wasDefaulted = true;
      if ("amount" in log.args) data.amount = log.args.amount;
      if (log.eventName === "PaymentDeclared") {
        data.slipHash = log.args.slipHash;
        const slip = await tx.slip.findFirst({
          where: { circleId: circleId!, round: r, payer, sha256: log.args.slipHash.slice(2) },
          orderBy: { createdAt: "desc" },
        });
        if (slip) data.slipId = slip.id;
      }
      await tx.payment.upsert({
        where: key,
        create: { circleId: circleId!, round: r, payer, ...(data as object) } as Prisma.PaymentUncheckedCreateInput,
        update: data,
      });

      const membership = await tx.membership.findUnique({
        where: { circleId_address: { circleId: circleId!, address: payer } },
      });
      if (log.eventName === "MemberDefaulted") {
        await tx.membership.updateMany({ where: { circleId: circleId!, address: payer }, data: { defaulted: true } });
      }
      if (membership?.userId && (status === "CONFIRMED" || status === "DEFAULTED")) {
        const userId = membership.userId;
        later.push(async () => {
          await recomputeReputation(ctx, userId);
        });
      }
      if (log.eventName === "PaymentDeclared" && "recipient" in log.args) {
        const recipient = log.args.recipient;
        later.push(() =>
          notifyAddress(ctx, recipient, {
            kind: "confirm_needed",
            title: `สมาชิกแจ้งโอนเงินรอบที่ ${r}`,
            body: "ตรวจสอบยอดในบัญชีของคุณ แล้วกดยืนยันการรับเงิน",
            circleId: circleId!,
          }),
        );
      }
      if ((log.eventName === "PaymentConfirmed" || log.eventName === "PaymentAccepted") && membership?.userId) {
        const userId = membership.userId;
        later.push(() =>
          notify(ctx, {
            userId,
            kind: "payment_confirmed",
            title:
              log.eventName === "PaymentAccepted"
                ? `การชำระรอบที่ ${r} ถือว่าเรียบร้อย ✓`
                : `ผู้รับยืนยันการรับเงินรอบที่ ${r} แล้ว ✓`,
            body:
              log.eventName === "PaymentAccepted"
                ? "ผู้รับไม่ได้ปฏิเสธภายในเวลาที่กำหนด ระบบจึงบันทึกว่าได้รับเงินแล้ว"
                : "บันทึกถาวรแล้ว",
            circleId: circleId!,
          }),
        );
      }
      if (log.eventName === "MemberDefaulted") {
        const circle = await tx.circle.findUniqueOrThrow({ where: { id: circleId! } });
        const affected = new Set([circle.hostId, membership?.userId].filter(Boolean) as string[]);
        for (const userId of affected) {
          later.push(() =>
            notify(ctx, {
              userId,
              kind: "member_defaulted",
              title: `มีการผิดนัดชำระในรอบที่ ${r}`,
              body: "บันทึกการผิดนัดถาวรแล้ว ดาวน์โหลดรายงานหลักฐานได้ที่หน้าวง",
              circleId: circleId!,
            }),
          );
        }
      }
      return;
    }
    case "Disputed": {
      await tx.dispute.updateMany({
        where: { circleId: circleId!, reasonHash: log.args.reasonHash, txHash: null },
        data: { txHash: log.transactionHash! },
      });
      const circle = await tx.circle.findUniqueOrThrow({ where: { id: circleId! } });
      later.push(() =>
        notify(ctx, {
          userId: circle.hostId,
          kind: "dispute",
          title: `มีการแจ้งปัญหาในวง "${circle.name}"`,
          body: `รอบที่ ${log.args.round} — ดูรายละเอียดในหน้าวง`,
          circleId: circle.id,
        }),
      );
      return;
    }
    case "MemberRotated": {
      const oldA = lower(log.args.oldMember);
      const newA = lower(log.args.newMember);
      const user = await tx.user.findUnique({ where: { walletAddress: newA }, select: { id: true } });
      await tx.membership.updateMany({
        where: { circleId: circleId!, address: oldA },
        data: { address: newA, ...(user ? { userId: user.id } : {}) },
      });
      await tx.debt.updateMany({ where: { circleId: circleId!, debtor: oldA }, data: { debtor: newA } });
      await tx.debt.updateMany({ where: { circleId: circleId!, creditor: oldA }, data: { creditor: newA } });
      const circle = await tx.circle.findUniqueOrThrow({ where: { id: circleId! } });
      if (circle.currentRound > 0) {
        await tx.payment.updateMany({
          where: { circleId: circleId!, round: circle.currentRound, payer: oldA },
          data: { payer: newA },
        });
        await tx.round.updateMany({
          where: { circleId: circleId!, number: circle.currentRound, recipient: oldA },
          data: { recipient: newA },
        });
      }
      if (circle.hostAddress === oldA) {
        await tx.circle.update({
          where: { id: circle.id },
          data: { hostAddress: newA, ...(user ? { hostId: user.id } : {}) },
        });
      }
      return;
    }
    case "HostRotated":
    case "CapsUpdated":
    case "Initialized":
    case "Paused":
    case "Unpaused":
    case "RoleGranted":
    case "RoleRevoked":
    case "RoleAdminChanged":
    case "EIP712DomainChanged":
    default:
      return;
  }
}

/**
 * Catches up with the chain from the stored cursor. Factory logs are ingested before circle logs
 * of the same range so circles created in the range are known when their own logs are filtered.
 */
export async function indexRange(ctx: Ctx, maxBlocks = 2_000n): Promise<{ from: bigint; to: bigint } | null> {
  const head = await ctx.chain.publicClient.getBlockNumber();
  const safe = head - BigInt(ctx.config.CONFIRMATIONS);
  const cursor = await ctx.db.chainCursor.findUnique({ where: { id: "main" } });
  const from = cursor ? cursor.blockNumber + 1n : ctx.config.DEPLOY_BLOCK;
  if (from > safe) return null;
  const to = safe - from + 1n > maxBlocks ? from + maxBlocks - 1n : safe;

  const factoryLogs = await ctx.chain.publicClient.getLogs({ address: ctx.chain.factory, fromBlock: from, toBlock: to });
  await ingestLogs(ctx, factoryLogs);

  const circles = (await ctx.db.circle.findMany({ where: { address: { not: null } }, select: { address: true } })).map(
    (c) => c.address as `0x${string}`,
  );
  for (let i = 0; i < circles.length; i += 500) {
    const logs = await ctx.chain.publicClient.getLogs({ address: circles.slice(i, i + 500), fromBlock: from, toBlock: to });
    logs.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);
    await ingestLogs(ctx, logs);
  }

  await ctx.db.chainCursor.upsert({ where: { id: "main" }, create: { id: "main", blockNumber: to }, update: { blockNumber: to } });
  return { from, to };
}

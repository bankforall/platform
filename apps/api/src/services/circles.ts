import type { Circle, Membership, Payment, Round, User } from "../db.js";
import {
  circleAbi,
  circleFactoryAbi,
  CircleType,
  createCircleBody,
  formatBaht,
  parsePromptPayId,
  promptPayPayload,
  type CircleDetail,
  type CircleSummary,
  type PreparedIntent,
} from "@bankforall/shared";
import { encodeFunctionData, getAddress, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import type { z } from "zod";
import type { Ctx } from "../context.js";
import { inviteCode as newInviteCode, sha256Hex } from "../crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { prepareIntent } from "./intents.js";
import { maskPromptPay, onboardingSteps } from "./users.js";

type CircleWith = Circle & { memberships: Membership[]; host: User };
const unix = (d: Date | null | undefined) => (d ? Math.floor(d.getTime() / 1000) : null);

function requireReady(user: User) {
  const steps = onboardingSteps(user);
  if (steps.length) throw forbidden(`กรุณาทำขั้นตอนเริ่มต้นให้ครบก่อน (${steps.join(", ")})`);
}

async function loadCircle(ctx: Ctx, id: string): Promise<CircleWith> {
  const circle = await ctx.db.circle.findUnique({
    where: { id },
    include: { memberships: { orderBy: { index: "asc" } }, host: true },
  });
  if (!circle) throw notFound("ไม่พบวงแชร์");
  return circle;
}

function myMembership(circle: CircleWith, user: User | null) {
  if (!user?.walletAddress) return null;
  return circle.memberships.find((m) => m.address === user.walletAddress) ?? null;
}

// ─────────────── views ───────────────

export async function summaryView(ctx: Ctx, circle: CircleWith, user: User | null): Promise<CircleSummary> {
  const me = myMembership(circle, user);
  let dueNow: NonNullable<CircleSummary["me"]>["dueNow"] = null;
  if (me && circle.status === "ACTIVE" && circle.currentRound > 0) {
    const [round, payment] = await Promise.all([
      ctx.db.round.findUnique({ where: { circleId_number: { circleId: circle.id, number: circle.currentRound } } }),
      ctx.db.payment.findUnique({
        where: { circleId_round_payer: { circleId: circle.id, round: circle.currentRound, payer: me.address } },
      }),
    ]);
    if (round?.decided && payment && payment.status !== "CONFIRMED" && payment.amount !== null) {
      const recipient = circle.memberships.find((m) => m.address === round.recipient);
      const recipientUser = recipient?.userId ? await ctx.db.user.findUnique({ where: { id: recipient.userId } }) : null;
      dueNow = {
        amount: payment.amount.toString(),
        to: recipientUser?.displayName ?? "ผู้รับ",
        deadline: unix(round.paymentDeadline) ?? 0,
        status: payment.status,
      };
    }
  }
  return {
    id: circle.id,
    name: circle.name,
    address: circle.address,
    status: circle.status,
    type: circle.type as CircleType,
    principal: circle.principal.toString(),
    maxMembers: circle.maxMembers,
    memberCount: circle.memberships.length,
    fixRateBps: circle.fixRateBps,
    period: circle.period,
    isPrivate: circle.isPrivate,
    currentRound: circle.currentRound,
    host: { id: circle.hostId, displayName: circle.host.displayName },
    takenSeats: circle.type === CircleType.Fix ? circle.memberships.map((m) => m.seat) : [],
    me: me
      ? {
          isHost: me.address === circle.hostAddress,
          seat: me.seat,
          hasWon: me.hasWon,
          defaulted: me.defaulted,
          dueNow,
        }
      : null,
  };
}

export async function detailView(ctx: Ctx, circleId: string, user: User | null): Promise<CircleDetail> {
  const circle = await loadCircle(ctx, circleId);
  const me = myMembership(circle, user);
  const isAdmin = user?.role === "ADMIN";
  if (circle.isPrivate && !me && circle.hostId !== user?.id && !isAdmin) throw notFound("ไม่พบวงแชร์");

  const [rounds, payments, slips, users, bids] = await Promise.all([
    ctx.db.round.findMany({ where: { circleId }, orderBy: { number: "asc" } }),
    ctx.db.payment.findMany({ where: { circleId } }),
    ctx.db.slip.findMany({ where: { circleId }, select: { id: true, verify: true } }),
    ctx.db.user.findMany({
      where: { id: { in: circle.memberships.map((m) => m.userId).filter(Boolean) as string[] } },
      select: { id: true, displayName: true, pictureUrl: true },
    }),
    ctx.db.chainEvent.findMany({
      where: { address: circle.address ?? "-", name: { in: ["BidCommitted", "BidRevealed"] } },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const nameOf = (address: string | null) => {
    const m = circle.memberships.find((x) => x.address === address);
    return (m?.userId && userById.get(m.userId)?.displayName) || (address ? `${address.slice(0, 6)}…` : "-");
  };
  const slipVerify = new Map(slips.map((s) => [s.id, s.verify]));

  const summary = await summaryView(ctx, circle, user);
  return {
    ...summary,
    description: circle.description,
    inviteCode: me?.address === circle.hostAddress || isAdmin ? circle.inviteCode : null,
    hostTakesFirst: circle.hostTakesFirst,
    minReputation: circle.minReputation,
    bidWindow: circle.bidWindow,
    revealWindow: circle.revealWindow,
    paymentWindow: circle.paymentWindow,
    grace: circle.grace,
    explorerUrl: circle.address && ctx.config.EXPLORER_URL ? `${ctx.config.EXPLORER_URL}/address/${circle.address}` : null,
    members: circle.memberships.map((m) => {
      const u = m.userId ? userById.get(m.userId) : undefined;
      return {
        address: m.address,
        userId: m.userId,
        displayName: u?.displayName ?? `${m.address.slice(0, 6)}…`,
        pictureUrl: u?.pictureUrl ?? null,
        index: m.index,
        seat: m.seat,
        reputation: m.reputation,
        hasWon: m.hasWon,
        wonRound: m.wonRound,
        wonBid: m.wonBid.toString(),
        defaulted: m.defaulted,
      };
    }),
    rounds: rounds.map((r) => roundView(circle, r, payments, bids, nameOf, slipVerify)),
  };
}

function roundView(
  circle: Circle,
  r: Round,
  payments: Payment[],
  bids: { name: string; args: unknown }[],
  nameOf: (a: string | null) => string,
  slipVerify: Map<string, "PENDING" | "VERIFIED" | "FAILED" | "SKIPPED">,
): CircleDetail["rounds"][number] {
  const roundBids = bids.filter((b) => Number((b.args as { round: string }).round) === r.number);
  return {
    number: r.number,
    startedAt: unix(r.startedAt)!,
    bidding: r.bidding,
    biddingEnds: unix(r.biddingEnds),
    revealEnds: unix(r.revealEnds),
    decided: r.decided,
    recipient: r.recipient,
    recipientName: r.recipient ? nameOf(r.recipient) : null,
    winningBid: r.winningBid.toString(),
    paymentDeadline: unix(r.paymentDeadline),
    defaultAfter: r.paymentDeadline ? unix(r.paymentDeadline)! + circle.grace : null,
    acceptAfter: r.paymentDeadline ? unix(r.paymentDeadline)! + 2 * circle.grace : null,
    payments: payments
      .filter((p) => p.round === r.number)
      .map((p) => ({
        payer: p.payer,
        payerName: nameOf(p.payer),
        amount: p.amount?.toString() ?? null,
        status: p.status,
        slipId: p.slipId,
        slipVerify: p.slipId ? (slipVerify.get(p.slipId) ?? null) : null,
        txHash: p.txHash,
      })),
    committed: roundBids
      .filter((b) => b.name === "BidCommitted")
      .map((b) => (b.args as { member: string }).member.toLowerCase()),
    revealed: roundBids
      .filter((b) => b.name === "BidRevealed")
      .map((b) => {
        const a = b.args as { member: string; amount: string };
        return { member: a.member.toLowerCase(), amount: a.amount };
      }),
  };
}

export async function listMine(ctx: Ctx, user: User): Promise<CircleSummary[]> {
  const circles = await ctx.db.circle.findMany({
    where: {
      OR: [
        { hostId: user.id, status: { not: "FAILED" } },
        ...(user.walletAddress ? [{ memberships: { some: { address: user.walletAddress } } }] : []),
      ],
      NOT: { status: "DRAFT", createdTx: null },
    },
    include: { memberships: { orderBy: { index: "asc" } }, host: true },
    orderBy: { updatedAt: "desc" },
  });
  return Promise.all(circles.map((c) => summaryView(ctx, c, user)));
}

export async function discover(ctx: Ctx, user: User): Promise<CircleSummary[]> {
  const circles = await ctx.db.circle.findMany({
    where: { status: "OPEN", isPrivate: false },
    include: { memberships: { orderBy: { index: "asc" } }, host: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Promise.all(circles.map((c) => summaryView(ctx, c, user)));
}

export async function byInvite(ctx: Ctx, user: User, code: string): Promise<CircleSummary> {
  const circle = await ctx.db.circle.findUnique({
    where: { inviteCode: code.toUpperCase() },
    include: { memberships: { orderBy: { index: "asc" } }, host: true },
  });
  if (!circle || circle.status === "DRAFT" || circle.status === "FAILED") throw notFound("ไม่พบวงจากรหัสเชิญนี้");
  return summaryView(ctx, circle, user);
}

// ─────────────── actions (each returns an intent to sign) ───────────────

export async function prepareCreate(
  ctx: Ctx,
  user: User,
  body: z.infer<typeof createCircleBody>,
): Promise<PreparedIntent> {
  requireReady(user);
  if (body.type !== CircleType.Fix && body.fixRateBps !== 0) throw badRequest("อัตราตามที่นั่งใช้ได้เฉพาะวงแบบเลือกที่นั่ง");
  if (body.hostSeat >= body.maxMembers) throw badRequest("ที่นั่งของนายวงไม่ถูกต้อง");
  const active = await ctx.db.circle.count({ where: { hostId: user.id, status: { in: ["OPEN", "ACTIVE"] } } });
  if (active >= 3) throw conflict("คุณเป็นนายวงครบ 3 วงแล้วตามเพดานกฎหมาย", "HOST_LIMIT");

  const circle = await ctx.db.circle.create({
    data: {
      name: body.name,
      description: body.description,
      hostId: user.id,
      hostAddress: user.walletAddress!,
      type: body.type,
      principal: body.principal,
      maxMembers: body.maxMembers,
      hostTakesFirst: body.hostTakesFirst,
      fixRateBps: body.fixRateBps,
      minReputation: body.minReputation,
      period: body.period,
      bidWindow: body.bidWindow,
      revealWindow: body.revealWindow,
      paymentWindow: body.paymentWindow,
      grace: body.grace,
      isPrivate: body.private,
      inviteCode: newInviteCode(),
    },
  });
  const { attestation, signature } = await ctx.signer.attestation(getAddress(user.walletAddress!), zeroAddress);
  const params = {
    circleType: body.type,
    hostTakesFirst: body.hostTakesFirst,
    maxMembers: body.maxMembers,
    fixRateBps: body.fixRateBps,
    minReputation: body.minReputation,
    principal: body.principal,
    period: BigInt(body.period),
    bidWindow: BigInt(body.bidWindow),
    revealWindow: BigInt(body.revealWindow),
    paymentWindow: BigInt(body.paymentWindow),
    grace: BigInt(body.grace),
  };
  return prepareIntent(ctx, user, {
    kind: "createCircle",
    circleId: circle.id,
    to: ctx.chain.factory,
    data: encodeFunctionData({
      abi: circleFactoryAbi,
      functionName: "createCircle",
      args: [params, body.hostSeat, attestation, signature],
    }),
    summary: `สร้างวง "${body.name}" ${body.maxMembers} มือ งวดละ ${formatBaht(body.principal)} บาท`,
  });
}

function onChain(circle: Circle): Address {
  if (!circle.address) throw conflict("วงนี้ยังไม่ถูกบันทึก", "NOT_DEPLOYED");
  return getAddress(circle.address);
}

export async function prepareJoin(ctx: Ctx, user: User, circleId: string, seat: number, code?: string) {
  requireReady(user);
  const circle = await loadCircle(ctx, circleId);
  if (circle.status !== "OPEN") throw conflict("วงนี้ไม่เปิดรับสมาชิกแล้ว", "NOT_OPEN");
  if (circle.isPrivate && code?.toUpperCase() !== circle.inviteCode) throw forbidden("รหัสเชิญไม่ถูกต้อง");
  if (myMembership(circle, user)) throw conflict("คุณเป็นสมาชิกวงนี้อยู่แล้ว", "ALREADY_MEMBER");
  if (user.reputation < circle.minReputation) throw forbidden("คะแนนความน่าเชื่อถือยังไม่ถึงเกณฑ์ของวงนี้");
  const address = onChain(circle);
  const { attestation, signature } = await ctx.signer.attestation(getAddress(user.walletAddress!), address);
  const seatText = circle.type === CircleType.Fix ? ` ที่นั่งที่ ${seat + 1}` : "";
  return prepareIntent(ctx, user, {
    kind: "join",
    circleId,
    to: address,
    data: encodeFunctionData({ abi: circleAbi, functionName: "join", args: [seat, attestation, signature] }),
    summary: `เข้าร่วมวง "${circle.name}"${seatText}`,
  });
}

export async function prepareHostAction(ctx: Ctx, user: User, circleId: string, action: "start" | "cancel") {
  const circle = await loadCircle(ctx, circleId);
  if (circle.hostAddress !== user.walletAddress) throw forbidden("เฉพาะนายวงเท่านั้น");
  return prepareIntent(ctx, user, {
    kind: action,
    circleId,
    to: onChain(circle),
    data: encodeFunctionData({ abi: circleAbi, functionName: action }),
    summary: action === "start" ? `เริ่มวง "${circle.name}" (เปิดรอบที่ 1)` : `ยกเลิกวง "${circle.name}"`,
  });
}

export async function prepareCommitBid(ctx: Ctx, user: User, circleId: string, hash: Hex) {
  const circle = await loadCircle(ctx, circleId);
  if (!myMembership(circle, user)) throw forbidden("คุณไม่ได้เป็นสมาชิกของวงนี้");
  const address = onChain(circle);
  return prepareIntent(ctx, user, {
    kind: "commitBid",
    circleId,
    to: address,
    data: encodeFunctionData({ abi: circleAbi, functionName: "commitBid", args: [hash] }),
    summary: `ยื่นซองประมูลรอบที่ ${circle.currentRound} (จำนวนจะถูกปิดไว้จนถึงเวลาเปิดซอง)`,
    meta: { round: circle.currentRound, circleAddress: address },
  });
}

export async function preparePayment(
  ctx: Ctx,
  user: User,
  circleId: string,
  file: { data: Buffer; contentType: string },
) {
  const circle = await loadCircle(ctx, circleId);
  const me = myMembership(circle, user);
  if (!me) throw forbidden("คุณไม่ได้เป็นสมาชิกของวงนี้");
  const payment = await ctx.db.payment.findUnique({
    where: { circleId_round_payer: { circleId, round: circle.currentRound, payer: me.address } },
  });
  if (!payment || payment.amount === null) throw conflict("ยังไม่มียอดที่ต้องชำระในรอบนี้", "NOTHING_DUE");
  if (payment.status !== "NONE") throw conflict("คุณแจ้งการโอนรอบนี้แล้ว", "ALREADY_DECLARED");
  const sha = sha256Hex(file.data);
  const key = await ctx.storage.put(`slips/${circleId}/${circle.currentRound}`, file.data);
  await ctx.db.slip.create({
    data: {
      circleId,
      round: circle.currentRound,
      userId: user.id,
      payer: me.address,
      storageKey: key,
      contentType: file.contentType,
      sha256: sha,
    },
  });
  return prepareIntent(ctx, user, {
    kind: "declarePayment",
    circleId,
    to: onChain(circle),
    data: encodeFunctionData({ abi: circleAbi, functionName: "declarePayment", args: [`0x${sha}`] }),
    summary: `แจ้งโอน ${formatBaht(payment.amount)} บาท รอบที่ ${circle.currentRound} พร้อมสลิป`,
  });
}

export async function prepareConfirm(ctx: Ctx, user: User, circleId: string, payer: string) {
  const circle = await loadCircle(ctx, circleId);
  const payment = await ctx.db.payment.findUnique({
    where: { circleId_round_payer: { circleId, round: circle.currentRound, payer: payer.toLowerCase() } },
  });
  if (!payment) throw notFound("ไม่พบรายการชำระ");
  const payerName =
    (await ctx.db.user.findUnique({ where: { walletAddress: payer.toLowerCase() } }))?.displayName ?? payer.slice(0, 8);
  return prepareIntent(ctx, user, {
    kind: "confirmReceipt",
    circleId,
    to: onChain(circle),
    data: encodeFunctionData({ abi: circleAbi, functionName: "confirmReceipt", args: [getAddress(payer)] }),
    summary: `ยืนยันว่าได้รับเงิน ${payment.amount ? formatBaht(payment.amount) + " บาท " : ""}จาก ${payerName} แล้ว`,
  });
}

/** The recipient states a declared transfer never arrived (before `acceptAfter`). */
export async function prepareReject(ctx: Ctx, user: User, circleId: string, payer: string) {
  const circle = await loadCircle(ctx, circleId);
  const payerName =
    (await ctx.db.user.findUnique({ where: { walletAddress: payer.toLowerCase() } }))?.displayName ?? payer.slice(0, 8);
  return prepareIntent(ctx, user, {
    kind: "rejectPayment",
    circleId,
    to: onChain(circle),
    data: encodeFunctionData({ abi: circleAbi, functionName: "rejectPayment", args: [getAddress(payer)] }),
    summary: `แจ้งว่ายังไม่ได้รับเงินจาก ${payerName}`,
  });
}

export async function prepareDispute(ctx: Ctx, user: User, circleId: string, round: number, reason: string) {
  const circle = await loadCircle(ctx, circleId);
  if (!myMembership(circle, user)) throw forbidden("คุณไม่ได้เป็นสมาชิกของวงนี้");
  if (round < 1 || round > Math.max(circle.currentRound, 1)) throw badRequest("รอบไม่ถูกต้อง");
  // one recorded dispute per member per round (each one costs gas and notifies the host)
  const existing = await ctx.db.dispute.findFirst({ where: { circleId, round, userId: user.id, txHash: { not: null } } });
  if (existing) throw conflict("คุณแจ้งปัญหาของรอบนี้แล้ว ติดตามผลกับนายวงหรือเจ้าหน้าที่", "DISPUTE_EXISTS");
  const reasonHash = keccak256(toBytes(reason));
  await ctx.db.dispute.create({ data: { circleId, round, userId: user.id, reason, reasonHash } });
  return prepareIntent(ctx, user, {
    kind: "dispute",
    circleId,
    to: onChain(circle),
    data: encodeFunctionData({ abi: circleAbi, functionName: "dispute", args: [round, reasonHash] }),
    summary: `แจ้งปัญหารอบที่ ${round}`,
  });
}

/** PromptPay QR for what the current user owes the current round's recipient. */
export async function myPromptPay(ctx: Ctx, user: User, circleId: string) {
  const circle = await loadCircle(ctx, circleId);
  const me = myMembership(circle, user);
  if (!me) throw forbidden("คุณไม่ได้เป็นสมาชิกของวงนี้");
  const round = await ctx.db.round.findUnique({
    where: { circleId_number: { circleId, number: circle.currentRound } },
  });
  if (!round?.decided || !round.recipient) throw conflict("ยังไม่มีผู้รับเงินในรอบนี้", "NO_RECIPIENT");
  const payment = await ctx.db.payment.findUnique({
    where: { circleId_round_payer: { circleId, round: circle.currentRound, payer: me.address } },
  });
  if (!payment?.amount) throw conflict("คุณไม่มียอดที่ต้องชำระในรอบนี้", "NOTHING_DUE");
  const recipient = await ctx.db.user.findUnique({ where: { walletAddress: round.recipient } });
  if (!recipient?.promptPayId) throw conflict("ผู้รับยังไม่ได้ตั้งค่าพร้อมเพย์", "NO_PROMPTPAY");
  return {
    payload: promptPayPayload(parsePromptPayId(recipient.promptPayId), payment.amount),
    amount: payment.amount.toString(),
    recipientName: recipient.displayName,
    promptPayMasked: maskPromptPay(recipient.promptPayId),
  };
}

export async function canSeeSlip(ctx: Ctx, user: User, slipId: string) {
  const slip = await ctx.db.slip.findUnique({ where: { id: slipId } });
  if (!slip) throw notFound();
  if (user.role !== "ADMIN" && slip.userId !== user.id) {
    const round = await ctx.db.round.findUnique({
      where: { circleId_number: { circleId: slip.circleId, number: slip.round } },
    });
    if (round?.recipient !== user.walletAddress) throw forbidden();
  }
  return slip;
}

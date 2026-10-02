import type { TxIntent, User } from "../db.js";
import {
  bidHash,
  circleAbi,
  forwarderAbi,
  forwarderDomain,
  forwardRequestTypes,
  type IntentKind,
  type IntentResponse,
  type PreparedIntent,
} from "@bankforall/shared";
import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { chainNow } from "../chain/clients.js";
import { contractErrorMessage } from "../chain/errors.js";
import type { Ctx } from "../context.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { ingestLogs } from "./ingest.js";

const INTENT_TTL_SECONDS = 10 * 60;
const GAS_OVERHEAD = 100_000n;

export interface PrepareInput {
  kind: IntentKind;
  circleId?: string;
  to: Address;
  data: Hex;
  summary: string;
  meta?: Record<string, unknown>;
}

/**
 * Builds a forward request for the user to sign. The inner call is simulated from the user's
 * address first, so contract errors surface here (in Thai) instead of after signing.
 */
export async function prepareIntent(ctx: Ctx, user: User, input: PrepareInput): Promise<PreparedIntent> {
  if (!user.walletAddress) throw badRequest("กรุณาตั้งค่ากุญแจของคุณก่อน", "NO_WALLET");
  const from = getAddress(user.walletAddress);
  let gas: bigint;
  try {
    gas = await ctx.chain.publicClient.estimateGas({ account: from, to: input.to, data: input.data });
  } catch (err) {
    throw badRequest(contractErrorMessage(err), "CONTRACT_REJECTED");
  }
  gas = (gas * 13n) / 10n + 30_000n;

  const nonce = await ctx.chain.publicClient.readContract({
    address: ctx.chain.forwarder,
    abi: forwarderAbi,
    functionName: "nonces",
    args: [from],
  });
  const deadline = (await chainNow(ctx.chain)) + INTENT_TTL_SECONDS;
  const intent = await ctx.db.txIntent.create({
    data: {
      userId: user.id,
      circleId: input.circleId,
      kind: input.kind,
      from: from.toLowerCase(),
      to: input.to.toLowerCase(),
      data: input.data,
      gas,
      nonce,
      deadline,
      meta: { ...(input.meta ?? {}), summary: input.summary },
    },
  });
  return {
    id: intent.id,
    kind: input.kind,
    summary: input.summary,
    typedData: {
      domain: forwarderDomain(ctx.chain.chainId, ctx.chain.forwarder),
      primaryType: "ForwardRequest",
      message: {
        from,
        to: getAddress(input.to),
        value: "0",
        gas: gas.toString(),
        nonce: nonce.toString(),
        deadline,
        data: input.data,
      },
    },
  };
}

export function intentView(i: TxIntent): IntentResponse {
  return {
    id: i.id,
    kind: i.kind as IntentKind,
    status: i.status,
    txHash: i.txHash,
    error: i.error,
    circleId: i.circleId,
  };
}

/**
 * Verifies the user's signature, relays the request through the forwarder, waits for the
 * receipt and ingests its events so the response already reflects the new state.
 */
export async function submitIntent(
  ctx: Ctx,
  user: User,
  intentId: string,
  signature: Hex,
  bid?: { amount: string; salt: string },
): Promise<IntentResponse> {
  const intent = await ctx.db.txIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw notFound();
  if (intent.userId !== user.id) throw forbidden();
  if (intent.status !== "PREPARED") throw conflict("รายการนี้ถูกส่งไปแล้ว", "ALREADY_SUBMITTED");
  if (intent.deadline < (await chainNow(ctx.chain)) + 30) {
    await ctx.db.txIntent.update({ where: { id: intent.id }, data: { status: "EXPIRED" } });
    throw badRequest("รายการหมดเวลา กรุณาทำรายการใหม่", "EXPIRED");
  }

  const message = {
    from: getAddress(intent.from),
    to: getAddress(intent.to),
    value: 0n,
    gas: intent.gas,
    nonce: intent.nonce,
    deadline: intent.deadline,
    data: intent.data as Hex,
  };
  const signer = await recoverTypedDataAddress({
    domain: forwarderDomain(ctx.chain.chainId, ctx.chain.forwarder),
    types: forwardRequestTypes,
    primaryType: "ForwardRequest",
    message,
    signature,
  }).catch(() => null);
  if (!signer || signer.toLowerCase() !== intent.from) throw badRequest("ลายเซ็นไม่ถูกต้อง", "BAD_SIGNATURE");

  const currentNonce = await ctx.chain.publicClient.readContract({
    address: ctx.chain.forwarder,
    abi: forwarderAbi,
    functionName: "nonces",
    args: [message.from],
  });
  if (currentNonce !== intent.nonce) {
    await ctx.db.txIntent.update({ where: { id: intent.id }, data: { status: "EXPIRED", error: "stale nonce" } });
    throw conflict("มีรายการอื่นถูกบันทึกก่อน กรุณาทำรายการใหม่", "STALE_NONCE");
  }

  if (intent.kind === "commitBid") await storeBidSecret(ctx, intent, bid);

  // claim the intent so a double submit cannot relay twice
  const claimed = await ctx.db.txIntent.updateMany({
    where: { id: intent.id, status: "PREPARED" },
    data: { status: "SUBMITTED" },
  });
  if (claimed.count === 0) throw conflict("รายการนี้ถูกส่งไปแล้ว", "ALREADY_SUBMITTED");

  const request = { ...message, deadline: message.deadline, signature };
  const executeData = encodeFunctionData({ abi: forwarderAbi, functionName: "execute", args: [request] });
  try {
    await ctx.chain.publicClient.call({ account: ctx.chain.relayer, to: ctx.chain.forwarder, data: executeData });
  } catch (err) {
    // the forwarder hides the inner revert; re-simulate the inner call to explain it
    const reason = await innerRevertReason(ctx, intent).catch(() => contractErrorMessage(err));
    return fail(ctx, intent.id, reason);
  }

  let txHash: Hex;
  try {
    txHash = await ctx.chain.sender.send(ctx.chain.relayer, {
      to: ctx.chain.forwarder,
      data: executeData,
      gas: intent.gas + GAS_OVERHEAD,
    });
  } catch (err) {
    ctx.log.error({ err, intent: intent.id }, "relay send failed");
    return fail(ctx, intent.id, "ระบบไม่สามารถส่งรายการได้ในขณะนี้ กรุณาลองใหม่");
  }
  await ctx.db.txIntent.update({ where: { id: intent.id }, data: { txHash } });
  if (intent.kind === "createCircle" && intent.circleId) {
    await ctx.db.circle.update({ where: { id: intent.circleId }, data: { createdTx: txHash } });
  }

  const receipt = await ctx.chain.sender.wait(txHash);
  if (receipt.status !== "success") {
    const reason = await innerRevertReason(ctx, intent).catch(() => "บันทึกรายการไม่สำเร็จ");
    if (intent.kind === "createCircle" && intent.circleId) {
      await ctx.db.circle.update({ where: { id: intent.circleId }, data: { status: "FAILED" } });
    }
    return fail(ctx, intent.id, reason);
  }
  await ingestLogs(ctx, receipt.logs);
  const done = await ctx.db.txIntent.update({ where: { id: intent.id }, data: { status: "CONFIRMED" } });
  return intentView(done);
}

async function fail(ctx: Ctx, id: string, error: string): Promise<IntentResponse> {
  const failed = await ctx.db.txIntent.update({ where: { id }, data: { status: "FAILED", error } });
  return intentView(failed);
}

async function innerRevertReason(ctx: Ctx, intent: TxIntent): Promise<string> {
  try {
    await ctx.chain.publicClient.call({
      account: getAddress(intent.from),
      to: getAddress(intent.to),
      data: intent.data as Hex,
    });
    return "บันทึกรายการไม่สำเร็จ กรุณาลองใหม่";
  } catch (err) {
    return contractErrorMessage(err);
  }
}

async function storeBidSecret(ctx: Ctx, intent: TxIntent, bid?: { amount: string; salt: string }) {
  if (!bid) throw badRequest("ต้องส่งจำนวนและ salt ของซองประมูล", "BID_SECRET_REQUIRED");
  const meta = intent.meta as { round: number; circleAddress: Address };
  const { args } = decodeFunctionData({ abi: circleAbi, data: intent.data as Hex });
  const committedHash = (args as readonly [Hex])[0];
  const expected = bidHash(meta.circleAddress, meta.round, getAddress(intent.from), BigInt(bid.amount), bid.salt as Hex);
  if (expected !== committedHash) throw badRequest("ข้อมูลซองไม่ตรงกับที่ลงนาม", "BID_MISMATCH");
  const data = {
    amountEnc: ctx.enc.encryptString(bid.amount),
    saltEnc: ctx.enc.encryptString(bid.salt),
  };
  await ctx.db.bidSecret.upsert({
    where: { circleId_round_member: { circleId: intent.circleId!, round: meta.round, member: intent.from } },
    create: { circleId: intent.circleId!, round: meta.round, member: intent.from, ...data },
    update: data,
  });
}

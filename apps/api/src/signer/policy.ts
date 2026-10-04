import { attestationTypes, circleAbi, factoryDomain, keyRotationMessage, keyRotationTypes } from "@bankforall/shared";
import { encodeFunctionData, getAddress, verifyMessage, zeroAddress, type Address, type Hex } from "viem";
import { chainNow, need, type Chain } from "../chain/clients.js";
import type { Config } from "../config.js";
import type { PrismaClient } from "../db.js";

/** Everything the attester-key holder needs: no storage, no encryption keys, no session secrets. */
export interface SignerCtx {
  config: Config;
  db: PrismaClient;
  chain: Chain;
}

export class PolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TTL = 30 * 60;

export interface SignedAttestation {
  attestation: { subject: Address; circle: Address; reputation: number; deadline: bigint };
  signature: Hex;
}

export interface RotationSignature {
  circle: Address;
  deadline: bigint;
  signature: Hex;
}

/**
 * KYC statement for `subject` to create (circle = 0x0) or join `circle`. Signed only if the database
 * shows an approved KYC for that key; the reputation is taken from the database, never the caller.
 */
export async function issueAttestation(ctx: SignerCtx, subject: Address, circle: Address): Promise<SignedAttestation> {
  const attester = need(ctx.chain.attester, "attester key");
  const user = await ctx.db.user.findUnique({ where: { walletAddress: subject.toLowerCase() } });
  if (!user || user.kycStatus !== "APPROVED") throw new PolicyError("KYC_REQUIRED", "subject has no approved KYC");
  const pendingRotation = await ctx.db.keyRotationRequest.findFirst({
    where: { userId: user.id, status: { in: ["PENDING", "APPROVED"] } },
  });
  if (pendingRotation) throw new PolicyError("ROTATION_PENDING", "account key is being replaced");
  if (circle !== zeroAddress) {
    const c = await ctx.db.circle.findUnique({ where: { address: circle.toLowerCase() } });
    if (!c || c.status !== "OPEN") throw new PolicyError("CIRCLE_NOT_OPEN", "circle is not open");
  }
  const attestation = {
    subject: getAddress(subject),
    circle: getAddress(circle),
    reputation: Math.max(0, Math.min(user.reputation, 2 ** 32 - 1)),
    deadline: BigInt((await chainNow(ctx.chain)) + TTL),
  };
  const signature = await attester.signTypedData!({
    domain: factoryDomain(ctx.chain.chainId, ctx.chain.factory),
    types: attestationTypes,
    primaryType: "Attestation",
    message: attestation,
  });
  return { attestation, signature };
}

/** Records on-chain that a slip was verified with the bank. Only for slips the verifier accepted. */
export async function attestSlipTx(ctx: SignerCtx, slipId: string): Promise<Hex> {
  const attester = need(ctx.chain.attester, "attester key");
  const slip = await ctx.db.slip.findUnique({ where: { id: slipId }, include: { circle: true } });
  if (!slip || slip.verify !== "VERIFIED" || !slip.circle.address) {
    throw new PolicyError("SLIP_NOT_VERIFIED", "slip is not verified");
  }
  const payment = await ctx.db.payment.findUnique({
    where: { circleId_round_payer: { circleId: slip.circleId, round: slip.round, payer: slip.payer } },
  });
  if (payment?.status !== "DECLARED" || payment.slipHash?.toLowerCase() !== `0x${slip.sha256}`) {
    throw new PolicyError("PAYMENT_NOT_DECLARED", "payment is not declared with this slip");
  }
  const hash = await ctx.chain.sender.send(attester, {
    to: getAddress(slip.circle.address),
    data: encodeFunctionData({ abi: circleAbi, functionName: "attestSlip", args: [getAddress(slip.payer), `0x${slip.sha256}`] }),
  });
  const receipt = await ctx.chain.sender.wait(hash);
  if (receipt.status !== "success") throw new PolicyError("TX_REVERTED", "attestSlip reverted");
  return hash;
}

/**
 * KeyRotation signatures for every open/active circle of the user. Requires: two different current
 * admins approved, the waiting time passed, the old key is still the account's key, and the new key
 * proved possession by signing the rotation message.
 */
export async function rotationSignatures(ctx: SignerCtx, requestId: string): Promise<RotationSignature[]> {
  const attester = need(ctx.chain.attester, "attester key");
  const req = await ctx.db.keyRotationRequest.findUnique({ where: { id: requestId }, include: { user: true } });
  if (!req || req.status !== "APPROVED") throw new PolicyError("NOT_APPROVED", "rotation is not approved");
  if (!req.executeAfter || req.executeAfter.getTime() > Date.now()) {
    throw new PolicyError("TIMELOCK", "waiting time has not passed");
  }
  const approvals = req.approvals as { adminId: string }[];
  const adminIds = [...new Set(approvals.map((a) => a.adminId))].filter((id) => id !== req.userId);
  const admins = await ctx.db.user.count({ where: { id: { in: adminIds }, role: "ADMIN" } });
  if (admins < 2) throw new PolicyError("APPROVALS", "two different admins must approve");
  if (req.user.walletAddress !== req.oldAddress) throw new PolicyError("STALE", "account key changed since the request");
  const ok = await verifyMessage({
    address: getAddress(req.newAddress),
    message: keyRotationMessage(req.userId, req.newAddress),
    signature: req.proof as Hex,
  }).catch(() => false);
  if (!ok) throw new PolicyError("BAD_PROOF", "new key did not sign the request");

  const memberships = await ctx.db.membership.findMany({
    where: { address: req.oldAddress, circle: { status: { in: ["OPEN", "ACTIVE"] } } },
    include: { circle: true },
  });
  const deadline = BigInt((await chainNow(ctx.chain)) + TTL);
  const out: RotationSignature[] = [];
  for (const m of memberships) {
    const circle = getAddress(m.circle.address!);
    const signature = await attester.signTypedData!({
      domain: factoryDomain(ctx.chain.chainId, ctx.chain.factory),
      types: keyRotationTypes,
      primaryType: "KeyRotation",
      message: { circle, oldMember: getAddress(req.oldAddress), newMember: getAddress(req.newAddress), deadline },
    });
    out.push({ circle, deadline, signature });
  }
  return out;
}

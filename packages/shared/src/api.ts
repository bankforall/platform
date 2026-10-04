import { z } from "zod";
import { CircleType } from "./circle-math.js";
import { createCircleSchema } from "./schemas.js";

/**
 * HTTP contract between apps/api and apps/web. All routes are under `/api`.
 * Amounts (satang) and other uint256 values travel as decimal strings.
 * Errors: `{ error: { code: string, message: string } }` with a 4xx/5xx status.
 *
 * Every on-chain action is two calls:
 *   1. a "prepare" route returns a `PreparedIntent` with EIP-712 typed data to sign;
 *   2. `POST /api/intents/:id/submit` with the signature; the API relays it and returns the result.
 */

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid address");
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/, "invalid hex");
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid bytes32");
const amount = z.string().regex(/^\d+$/, "amount must be a non-negative integer string");

// ─────────────── users ───────────────

export const KycStatus = z.enum(["NONE", "PENDING", "APPROVED", "REJECTED"]);
export type KycStatus = z.infer<typeof KycStatus>;

export const meResponse = z.object({
  id: z.string(),
  displayName: z.string(),
  pictureUrl: z.string().nullable(),
  role: z.enum(["USER", "ADMIN"]),
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  promptPayId: z.string().nullable(),
  consentVersion: z.string().nullable(),
  walletAddress: address.nullable(),
  hasWalletBackup: z.boolean(),
  kycStatus: KycStatus,
  kycReason: z.string().nullable(),
  reputation: z.number().int(),
  /** Steps still required before the user can create or join a circle, in order. */
  onboarding: z.array(z.enum(["phone", "promptpay", "consent", "wallet", "kyc"])),
  /** Unpaid defaults; while > 0 the user cannot create or join circles (decisions D5). */
  outstandingDefaults: z.number().int(),
  /** Key recovery in progress (see POST /api/me/key-rotation). */
  pendingKeyRotation: z
    .object({
      id: z.string(),
      newAddress: address,
      approvals: z.number().int(),
      /** Set once two admins approved; the switch happens after this time (unix seconds). */
      executeAfter: z.number().int().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
});
export type MeResponse = z.infer<typeof meResponse>;

export const CONSENT_VERSION = "2026-10-01";

export const sendOtpBody = z.object({ phone: z.string().regex(/^0\d{9}$/, "เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0") });
export const verifyOtpBody = z.object({ code: z.string().regex(/^\d{6}$/) });
/**
 * Changing an existing PromptPay ID needs a fresh OTP (`POST /api/me/step-up/otp`), and is refused
 * while the user is the recipient of an unsettled round.
 */
export const promptPayBody = z.object({
  promptPayId: z.string().min(10).max(20),
  code: z.string().regex(/^\d{6}$/).optional(),
});
export const consentBody = z.object({ version: z.literal(CONSENT_VERSION) });
/**
 * Registers the device-generated key; `backup` is encrypted client-side with the recovery code.
 * `proof` = personal_sign of `walletProofMessage(userId, address)` with that key.
 */
export const walletBody = z.object({
  address,
  proof: hex,
  backup: z.object({ v: z.literal(1), salt: z.string(), iv: z.string(), ciphertext: z.string() }),
});
export type WalletBackup = z.infer<typeof walletBody>["backup"];
/** multipart fields of `POST /api/me/kyc` besides the `idCard` and `selfie` files. */
export const kycFields = z.object({
  fullName: z.string().trim().min(3).max(100),
  nationalId: z.string().regex(/^\d{13}$/, "เลขประจำตัวประชาชน 13 หลัก"),
});

/** Lost device and recovery code: request a switch to a new key (needs two admins, then 24 hours). */
export const keyRotationRequestBody = z.object({
  newAddress: address,
  /** personal_sign of `keyRotationMessage(userId, newAddress)` with the new key */
  proof: hex,
});

/** Messages signed with EIP-191 personal_sign to prove possession of a key. */
export const walletProofMessage = (userId: string, address: string) =>
  `Bank For All\nยืนยันว่าเป็นเจ้าของกุญแจนี้\nบัญชี: ${userId}\nกุญแจ: ${address.toLowerCase()}`;
export const keyRotationMessage = (userId: string, newAddress: string) =>
  `Bank For All\nขอเปลี่ยนกุญแจของบัญชีเป็นกุญแจนี้\nบัญชี: ${userId}\nกุญแจใหม่: ${newAddress.toLowerCase()}`;

// ─────────────── intents (relayed transactions) ───────────────

export const IntentKind = z.enum([
  "createCircle",
  "join",
  "start",
  "cancel",
  "commitBid",
  "declarePayment",
  "confirmReceipt",
  "rejectPayment",
  "dispute",
]);
export type IntentKind = z.infer<typeof IntentKind>;

export const preparedIntent = z.object({
  id: z.string(),
  kind: IntentKind,
  /** Pass to viem `signTypedData` as-is (numbers are strings; convert with `toTypedDataMessage`). */
  typedData: z.object({
    domain: z.object({ name: z.string(), version: z.string(), chainId: z.number(), verifyingContract: address }),
    primaryType: z.literal("ForwardRequest"),
    message: z.object({
      from: address,
      to: address,
      value: amount,
      gas: amount,
      nonce: amount,
      deadline: z.number().int(),
      data: hex,
    }),
  }),
  /** Human-readable summary shown in the confirmation sheet before signing. */
  summary: z.string(),
});
export type PreparedIntent = z.infer<typeof preparedIntent>;

export const submitIntentBody = z.object({
  signature: hex,
  /** commitBid only: kept server-side (encrypted) so the keeper can reveal the bid on time. */
  bid: z
    .object({ amount: amount.refine((v) => BigInt(v) < 2n ** 128n, "amount too large"), salt: bytes32 })
    .optional(),
});

export const intentResponse = z.object({
  id: z.string(),
  kind: IntentKind,
  status: z.enum(["PREPARED", "SUBMITTED", "CONFIRMED", "FAILED", "EXPIRED"]),
  txHash: hex.nullable(),
  error: z.string().nullable(),
  circleId: z.string().nullable(),
});
export type IntentResponse = z.infer<typeof intentResponse>;

// ─────────────── circles ───────────────

export const CircleStatus = z.enum(["DRAFT", "OPEN", "ACTIVE", "COMPLETED", "CANCELLED", "FAILED"]);
export type CircleStatus = z.infer<typeof CircleStatus>;
export const PaymentStatus = z.enum(["NONE", "DECLARED", "ATTESTED", "CONFIRMED", "DEFAULTED"]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const createCircleBody = createCircleSchema.and(
  z.object({ description: z.string().max(500).optional(), hostSeat: z.number().int().min(0).max(29).default(0) }),
);
export const joinCircleBody = z.object({
  seat: z.number().int().min(0).max(29).default(0),
  inviteCode: z.string().optional(),
});
export const commitBidBody = z.object({ hash: bytes32 });
export const disputeBody = z.object({ round: z.number().int().min(1), reason: z.string().trim().min(5).max(2000) });

export const circleSummary = z.object({
  id: z.string(),
  name: z.string(),
  address: address.nullable(),
  status: CircleStatus,
  type: z.enum(CircleType),
  principal: amount,
  maxMembers: z.number().int(),
  memberCount: z.number().int(),
  fixRateBps: z.number().int(),
  period: z.number().int(),
  isPrivate: z.boolean(),
  currentRound: z.number().int(),
  host: z.object({ id: z.string().nullable(), displayName: z.string() }),
  /** Seats already taken (Fix circles). */
  takenSeats: z.array(z.number().int()),
  /** Largest bid/discount per round (interest cap, decisions D3); null for Fix or not yet known. */
  maxBid: amount.nullable(),
  /** Reputation needed to receive in rounds 1..⌊N/2⌋ and for Fix first-half seats (decisions D2). */
  trustedReputation: z.number().int().nullable(),
  /** Open circles may be cancelled by anyone after this time (unix seconds, decisions D4). */
  openUntil: z.number().int().nullable(),
  /** Present for members only. */
  me: z
    .object({
      isHost: z.boolean(),
      seat: z.number().int(),
      hasWon: z.boolean(),
      defaulted: z.boolean(),
      /** What I owe in the current round, if anything is still open. */
      dueNow: z.object({ amount, to: z.string(), deadline: z.number().int(), status: PaymentStatus }).nullable(),
    })
    .nullable(),
});
export type CircleSummary = z.infer<typeof circleSummary>;

export const memberView = z.object({
  address,
  userId: z.string().nullable(),
  displayName: z.string(),
  pictureUrl: z.string().nullable(),
  index: z.number().int(),
  seat: z.number().int(),
  reputation: z.number().int(),
  hasWon: z.boolean(),
  wonRound: z.number().int().nullable(),
  wonBid: amount,
  defaulted: z.boolean(),
  /** reputation ≥ circle.trustedReputation */
  trusted: z.boolean(),
});

export const paymentView = z.object({
  payer: address,
  payerName: z.string(),
  amount: amount.nullable(),
  /** Part of the due set off against the recipient's unpaid debt to this payer (decisions D1). */
  offset: amount,
  status: PaymentStatus,
  slipId: z.string().nullable(),
  slipVerify: z.enum(["PENDING", "VERIFIED", "FAILED", "SKIPPED"]).nullable(),
  txHash: hex.nullable(),
});

export const roundView = z.object({
  number: z.number().int(),
  startedAt: z.number().int(),
  bidding: z.boolean(),
  biddingEnds: z.number().int().nullable(),
  revealEnds: z.number().int().nullable(),
  decided: z.boolean(),
  recipient: address.nullable(),
  recipientName: z.string().nullable(),
  winningBid: amount,
  paymentDeadline: z.number().int().nullable(),
  /** paymentDeadline + grace: after this, members who have not declared can be marked in default. */
  defaultAfter: z.number().int().nullable(),
  /** paymentDeadline + 2 × grace: until this the recipient may reject a declared payment; after it, it is accepted. */
  acceptAfter: z.number().int().nullable(),
  payments: z.array(paymentView),
  /** Members who committed a sealed bid (amounts stay hidden until revealed). */
  committed: z.array(address),
  revealed: z.array(z.object({ member: address, amount })),
});

export const circleDetail = circleSummary.extend({
  description: z.string().nullable(),
  inviteCode: z.string().nullable(),
  hostTakesFirst: z.boolean(),
  minReputation: z.number().int(),
  bidWindow: z.number().int(),
  revealWindow: z.number().int(),
  paymentWindow: z.number().int(),
  grace: z.number().int(),
  members: z.array(memberView),
  rounds: z.array(roundView),
  explorerUrl: z.string().nullable(),
});
export type CircleDetail = z.infer<typeof circleDetail>;

export const promptPayQrResponse = z.object({
  payload: z.string(),
  amount,
  recipientName: z.string(),
  promptPayMasked: z.string(),
});

// ─────────────── notifications & admin ───────────────

export const notificationView = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  circleId: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});

export const kycReviewItem = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  fullName: z.string(),
  nationalIdLast4: z.string(),
  status: KycStatus,
  createdAt: z.string(),
});
export const kycDecisionBody = z.object({
  approve: z.boolean(),
  reason: z.string().max(500).optional(),
  reputation: z.number().int().min(0).max(1000).optional(),
});
export const keyRotationView = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  oldAddress: address,
  newAddress: address,
  status: z.enum(["PENDING", "APPROVED", "EXECUTED", "CANCELLED", "FAILED"]),
  approvals: z.array(z.object({ adminId: z.string(), adminName: z.string(), at: z.string() })),
  executeAfter: z.string().nullable(),
  createdAt: z.string(),
});
export type KeyRotationView = z.infer<typeof keyRotationView>;

/**
 * Admin passkeys (WebAuthn) — second factor on top of LINE login.
 * Error codes on admin routes: ADMIN_PASSKEY_REQUIRED (enrol a passkey first), ADMIN_STEP_UP_REQUIRED
 * (confirm with a passkey, then retry), ADMIN_REAUTH_REQUIRED (first enrolment needs a fresh login).
 */
export const ADMIN_ERROR = {
  passkeyRequired: "ADMIN_PASSKEY_REQUIRED",
  stepUpRequired: "ADMIN_STEP_UP_REQUIRED",
  reauthRequired: "ADMIN_REAUTH_REQUIRED",
} as const;
export const adminPasskeyView = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type AdminPasskeyView = z.infer<typeof adminPasskeyView>;
export const adminSecurityView = z.object({
  /** Passkey + step-up enforced for every admin (always true in production). */
  required: z.boolean(),
  passkeys: z.array(adminPasskeyView),
  /** Until when this session may perform admin changes without another passkey prompt. */
  stepUpExpiresAt: z.string().nullable(),
  /** Can a passkey be added now: "open", needs a passkey "step-up", or needs a fresh "relogin" (first one). */
  enrolment: z.enum(["open", "step-up", "relogin"]),
});
export type AdminSecurityView = z.infer<typeof adminSecurityView>;
/** WebAuthn options/credential JSON (validated by @simplewebauthn on the server). */
const webauthnJson = z.record(z.string(), z.unknown());
export const webauthnOptions = webauthnJson;
export const passkeyRegisterBody = z.object({
  name: z.string().trim().min(1).max(50),
  response: webauthnJson,
});
export const passkeyAssertionBody = z.object({ response: webauthnJson });
export const adminStepUpResponse = z.object({ expiresAt: z.string() });

/** Converts the string fields of a prepared ForwardRequest to the bigint types viem expects. */
export function toTypedDataMessage(m: PreparedIntent["typedData"]["message"]) {
  return {
    from: m.from as `0x${string}`,
    to: m.to as `0x${string}`,
    value: BigInt(m.value),
    gas: BigInt(m.gas),
    nonce: BigInt(m.nonce),
    deadline: m.deadline,
    data: m.data as `0x${string}`,
  };
}

export const circleTypeLabel: Record<CircleType, string> = {
  [CircleType.Fix]: "เลือกที่นั่ง (Fix)",
  [CircleType.Float]: "ประมูลดอกตาม (Float)",
  [CircleType.Discount]: "ประมูลดอกหัก (Discount)",
};

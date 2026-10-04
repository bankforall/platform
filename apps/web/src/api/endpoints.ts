import { z } from "zod";
import {
  TERMS_VERSION,
  adminDeletionRequestView,
  circleDetail,
  circleSummary,
  intentResponse,
  keyRotationView,
  kycReviewItem,
  meResponse,
  notificationView,
  preparedIntent,
  promptPayQrResponse,
  walletBody,
  type WalletBackup,
} from "@bankforall/shared";
import { request } from "./client";

export const appConfig = z.object({
  chainId: z.number(),
  forwarder: z.string(),
  factory: z.string(),
  explorerUrl: z.string().nullable(),
  lineLoginEnabled: z.boolean(),
  devLoginEnabled: z.boolean(),
});
export type AppConfig = z.infer<typeof appConfig>;

const backupSchema = walletBody.shape.backup;
export type NotificationView = z.infer<typeof notificationView>;
export type KycReviewItem = z.infer<typeof kycReviewItem>;
export type PromptPayQr = z.infer<typeof promptPayQrResponse>;
export type KeyRotationStatus = "PENDING" | "APPROVED";
export type DeletionRequestStatus = "PENDING" | "CANCELLED" | "REFUSED" | "COMPLETED";
const otpResponse = z.object({ ok: z.boolean(), devCode: z.string().optional() });

/** Body for `POST /circles` — amounts as strings, durations in seconds. */
export interface CreateCircleRequest {
  name: string;
  description?: string;
  type: number;
  principal: string;
  maxMembers: number;
  hostTakesFirst: boolean;
  fixRateBps: number;
  minReputation: number;
  period: number;
  bidWindow: number;
  revealWindow: number;
  paymentWindow: number;
  grace: number;
  private: boolean;
  hostSeat: number;
}

export const api = {
  config: () => request("/config", { schema: appConfig }),

  // auth
  devLogin: (displayName: string) => request("/auth/dev-login", { body: { displayName } }),
  logout: () => request("/auth/logout", { method: "POST" }),
  lineLoginUrl: (redirect = "/") => `/api/auth/line/start?redirect=${encodeURIComponent(redirect)}`,

  // me
  me: () => request("/me", { schema: meResponse }),
  sendOtp: (phone: string) => request("/me/phone/otp", { body: { phone }, schema: otpResponse }),
  verifyOtp: (code: string) => request("/me/phone/verify", { body: { code } }),
  /** Fresh OTP to the verified phone, required to change an existing PromptPay ID. */
  stepUpOtp: () => request("/me/step-up/otp", { method: "POST", schema: otpResponse }),
  /** `code` (step-up OTP) is required when replacing an existing PromptPay ID. */
  setPromptPay: (promptPayId: string, code?: string) =>
    request("/me/promptpay", { method: "PUT", body: { promptPayId, code } }),
  consent: () => request("/me/consent", { body: { version: TERMS_VERSION } }),
  /** `proof` = personal_sign of `walletProofMessage(me.id, address)` with the device key. */
  registerWallet: (address: string, proof: string, backup: WalletBackup) =>
    request("/me/wallet", { method: "PUT", body: { address, proof, backup } }),
  /** Lost device and recovery code: ask to switch the account to a new key (two admins + 24 h). */
  requestKeyRotation: (newAddress: string, proof: string) =>
    request("/me/key-rotation", { body: { newAddress, proof }, schema: meResponse }),
  cancelKeyRotation: () => request("/me/key-rotation", { method: "DELETE" }),
  walletBackup: () => request("/me/wallet/backup", { schema: backupSchema }),
  submitKyc: (form: FormData) => request("/me/kyc", { form }),
  notifications: () => request("/me/notifications", { schema: z.array(notificationView) }),
  readNotifications: () => request("/me/notifications/read", { method: "POST" }),
  /** All personal data held about me, as JSON (PDPA; at most once an hour). */
  exportData: () => request("/me/export"),
  /** Asks for account deletion; refused while I am in an unfinished circle or owe defaults. */
  requestDeletion: () => request("/me/deletion-request", { method: "POST", schema: meResponse }),
  cancelDeletion: () => request("/me/deletion-request", { method: "DELETE", schema: meResponse }),

  // circles
  myCircles: () => request("/circles", { schema: z.array(circleSummary) }),
  discover: () => request("/circles/discover", { schema: z.array(circleSummary) }),
  circleByInvite: (code: string) =>
    request(`/circles/invite/${encodeURIComponent(code.trim())}`, { schema: circleSummary }),
  circle: (id: string) => request(`/circles/${id}`, { schema: circleDetail }),
  promptPay: (id: string) => request(`/circles/${id}/promptpay`, { schema: promptPayQrResponse }),
  evidenceUrl: (id: string) => `/api/circles/${id}/evidence`,
  slipUrl: (slipId: string) => `/api/slips/${slipId}`,

  // prepare (return a PreparedIntent to sign)
  prepareCreate: (body: CreateCircleRequest) => request("/circles", { body, schema: preparedIntent }),
  prepareJoin: (id: string, seat: number, inviteCode?: string) =>
    request(`/circles/${id}/join`, { body: { seat, inviteCode }, schema: preparedIntent }),
  prepareStart: (id: string) => request(`/circles/${id}/start`, { method: "POST", schema: preparedIntent }),
  prepareCancel: (id: string) => request(`/circles/${id}/cancel`, { method: "POST", schema: preparedIntent }),
  prepareBid: (id: string, hash: string) =>
    request(`/circles/${id}/bids`, { body: { hash }, schema: preparedIntent }),
  preparePayment: (id: string, slip: File) => {
    const form = new FormData();
    form.append("slip", slip);
    return request(`/circles/${id}/payments`, { form, schema: preparedIntent });
  },
  prepareConfirm: (id: string, payer: string) =>
    request(`/circles/${id}/payments/${payer}/confirm`, { method: "POST", schema: preparedIntent }),
  prepareReject: (id: string, payer: string) =>
    request(`/circles/${id}/payments/${payer}/reject`, { method: "POST", schema: preparedIntent }),
  prepareDispute: (id: string, round: number, reason: string) =>
    request(`/circles/${id}/disputes`, { body: { round, reason }, schema: preparedIntent }),

  // intents
  submitIntent: (id: string, signature: string, bid?: { amount: string; salt: string }) =>
    request(`/intents/${id}/submit`, { body: { signature, bid }, schema: intentResponse }),
  intent: (id: string) => request(`/intents/${id}`, { schema: intentResponse }),

  // admin
  kycQueue: (status = "PENDING") =>
    request(`/admin/kyc?status=${status}`, { schema: z.array(kycReviewItem) }),
  kycImageUrl: (id: string, kind: "idCard" | "selfie") => `/api/admin/kyc/${id}/${kind}`,
  kycDecision: (id: string, approve: boolean, reason?: string, reputation?: number) =>
    request(`/admin/kyc/${id}/decision`, { body: { approve, reason, reputation } }),
  keyRotations: (status: KeyRotationStatus = "PENDING") =>
    request(`/admin/key-rotations?status=${status}`, { schema: z.array(keyRotationView) }),
  approveKeyRotation: (id: string) =>
    request(`/admin/key-rotations/${id}/approve`, { method: "POST", schema: keyRotationView }),
  rejectKeyRotation: (id: string, reason: string) => request(`/admin/key-rotations/${id}/reject`, { body: { reason } }),
  deletionRequests: (status: DeletionRequestStatus = "PENDING") =>
    request(`/admin/deletion-requests?status=${status}`, { schema: z.array(adminDeletionRequestView) }),
};

export const qk = {
  config: ["config"] as const,
  me: ["me"] as const,
  notifications: ["notifications"] as const,
  myCircles: ["circles", "mine"] as const,
  discover: ["circles", "discover"] as const,
  circle: (id: string) => ["circles", "detail", id] as const,
  promptPay: (id: string) => ["circles", "promptpay", id] as const,
  kyc: (status: string) => ["admin", "kyc", status] as const,
  keyRotations: (status: string) => ["admin", "key-rotations", status] as const,
  deletionRequests: (status: string) => ["admin", "deletion-requests", status] as const,
};

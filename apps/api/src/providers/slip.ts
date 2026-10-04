import type { Config } from "../config.js";

export type SlipResult =
  | { status: "VERIFIED"; detail: Record<string, unknown> }
  | { status: "FAILED"; detail: Record<string, unknown> }
  | { status: "SKIPPED"; detail: Record<string, unknown> };

export interface SlipVerifier {
  verify(input: { image: Buffer; contentType: string; expectedAmount: bigint; receiverPromptPayId: string }): Promise<SlipResult>;
}

/**
 * The provider could not give a verdict (network, outage, quota, credentials). The worker keeps the
 * slip PENDING and retries with backoff; `operator` errors need a human (alert right away).
 */
export class SlipProviderError extends Error {
  constructor(
    message: string,
    readonly operator = false,
  ) {
    super(message);
    this.name = "SlipProviderError";
  }
}

/**
 * No automatic verification: the recipient's on-chain confirmation is what settles a payment.
 * Plug a bank slip-verification API (it reads the QR on Thai bank slips) in here; a VERIFIED
 * result makes the worker call `attestSlip` so the slip is marked as checked on-chain.
 */
class NoSlipVerifier implements SlipVerifier {
  async verify() {
    return { status: "SKIPPED" as const, detail: { reason: "no slip verification provider configured" } };
  }
}

/**
 * Compares a provider's masked PromptPay proxy (e.g. "086xxx0000", "x-xxxx-xxxxx-12-3") with the
 * expected PromptPay id (digits). Masked positions are skipped; the visible digits must all match,
 * right-aligned, and at least 4 of them must be visible. Mobile ids also match the 66-prefixed form.
 * Returns null when the masked value cannot be compared at all.
 */
export function maskedIdMatches(masked: string, expected: string): boolean | null {
  const m = masked.toLowerCase().replace(/[^0-9x*]/g, "").replace(/\*/g, "x");
  if (!m || !/^\d+$/.test(expected)) return null;
  const candidates = [expected];
  if (/^0\d{9}$/.test(expected)) candidates.push("66" + expected.slice(1));
  const visible = (m.match(/\d/g) ?? []).length;
  if (visible < 4) return null;
  return candidates.some((e) => {
    if (m.length !== e.length) return false;
    for (let i = 0; i < m.length; i++) if (m[i] !== "x" && m[i] !== e[i]) return false;
    return true;
  });
}

interface SlipOkParty {
  displayName?: string;
  name?: string;
  proxy?: { type?: string | null; value?: string | null } | null;
  account?: { type?: string | null; value?: string | null } | null;
}
interface SlipOkResponse {
  success?: boolean;
  code?: number | string;
  message?: string;
  data?: {
    success?: boolean;
    transRef?: string;
    transTimestamp?: string;
    sendingBank?: string;
    receivingBank?: string;
    amount?: number;
    receiver?: SlipOkParty;
  };
}

/** SlipOK codes that say something about the slip itself (→ FAILED, payer is told). */
const SLIP_FAULTS: Record<number, string> = {
  1000: "no slip data",
  1005: "unsupported image type",
  1006: "image unreadable",
  1007: "no QR code on the image",
  1008: "QR code is not a payment slip",
  1011: "slip QR expired or transaction not found",
  1012: "duplicate slip (already submitted before)",
  1013: "amount does not match",
};
/** SlipOK codes that need the operator (credentials, branch, package/quota, branch receiver binding). */
const OPERATOR_FAULTS = new Set([1001, 1002, 1003, 1004, 1014]);
// 1009 (bank data temporarily unavailable), 1010 (bank needs a delay before checking) and anything
// unknown are transient: retried later.

/**
 * SlipOK (https://slipok.com/api-documentation/): POST https://api.slipok.com/api/line/apikey/<BRANCH_ID>,
 * header `x-authorization: <API_KEY>`, multipart `files` (the slip image) + `amount` (baht) + `log=true`
 * (records the slip with SlipOK so a re-used slip returns code 1012).
 *
 * Only the slip image and the expected amount are sent — never names, phone numbers, PromptPay ids
 * or circle data. The receiver is compared locally from the masked proxy SlipOK returns.
 *
 * VERIFIED needs: success, amount === expected (satang), and the receiver's PromptPay proxy visibly
 * matching the recipient's PromptPay id. If the slip does not show a comparable proxy (e.g. a plain
 * bank-account transfer) the result is SKIPPED: the recipient's confirmation decides, as without a verifier.
 */
export class SlipOkVerifier implements SlipVerifier {
  constructor(private readonly config: Pick<Config, "SLIPOK_BRANCH_ID" | "SLIPOK_API_KEY">) {}

  async verify(input: { image: Buffer; contentType: string; expectedAmount: bigint; receiverPromptPayId: string }): Promise<SlipResult> {
    const form = new FormData();
    const ext = input.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    form.append("files", new Blob([new Uint8Array(input.image)], { type: input.contentType }), `slip.${ext}`);
    form.append("amount", bahtString(input.expectedAmount));
    form.append("log", "true");

    let res: Response;
    try {
      res = await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(this.config.SLIPOK_BRANCH_ID)}`, {
        method: "POST",
        headers: { "x-authorization": this.config.SLIPOK_API_KEY },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new SlipProviderError(`SlipOK request failed: ${(err as Error).name}`);
    }
    const body = (await res.json().catch(() => null)) as SlipOkResponse | null;
    if (!body) throw new SlipProviderError(`SlipOK responded ${res.status} without JSON`);

    if (!res.ok || body.success === false || !body.data) {
      const code = Number(body.code);
      if (SLIP_FAULTS[code]) {
        return { status: "FAILED", detail: { provider: "slipok", code, reason: SLIP_FAULTS[code] } };
      }
      throw new SlipProviderError(`SlipOK responded ${res.status} code ${Number.isFinite(code) ? code : "?"}`, OPERATOR_FAULTS.has(code));
    }

    const d = body.data;
    const amountSatang = typeof d.amount === "number" ? BigInt(Math.round(d.amount * 100)) : null;
    const proxy = d.receiver?.proxy?.value ?? "";
    const detail: Record<string, unknown> = {
      provider: "slipok",
      transRef: d.transRef,
      transTimestamp: d.transTimestamp,
      amount: amountSatang?.toString() ?? null,
      expectedAmount: input.expectedAmount.toString(),
      receiverProxyType: d.receiver?.proxy?.type ?? null,
    };
    if (d.success === false) return { status: "FAILED", detail: { ...detail, reason: "provider could not validate the slip" } };
    if (amountSatang !== input.expectedAmount) return { status: "FAILED", detail: { ...detail, reason: "amount does not match" } };
    const match = proxy ? maskedIdMatches(proxy, input.receiverPromptPayId) : null;
    if (match === false) return { status: "FAILED", detail: { ...detail, reason: "receiver does not match the round's recipient" } };
    if (match === null) return { status: "SKIPPED", detail: { ...detail, reason: "slip does not show a comparable PromptPay receiver" } };
    return { status: "VERIFIED", detail };
  }
}

/** 150000n satang → "1500.00" */
function bahtString(satang: bigint): string {
  return `${satang / 100n}.${(satang % 100n).toString().padStart(2, "0")}`;
}

export function createSlipVerifier(config: Config): SlipVerifier {
  switch (config.SLIP_VERIFIER) {
    case "slipok":
      return new SlipOkVerifier(config);
    case "none":
      return new NoSlipVerifier();
  }
}

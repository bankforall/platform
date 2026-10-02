/**
 * PromptPay QR payload (Thai QR Payment, EMVCo Merchant-Presented Mode).
 * The app shows this QR so a payer can transfer the exact amount due to the round's recipient.
 */

export type PromptPayKind = "mobile" | "nationalId" | "eWallet";

export interface PromptPayTarget {
  kind: PromptPayKind;
  /** Digits only after normalisation. */
  id: string;
}

const AID_PROMPTPAY = "A000000677010111";

function field(tag: string, value: string): string {
  return tag + value.length.toString().padStart(2, "0") + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as required by EMVCo tag 63. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Accepts a Thai mobile number (0XXXXXXXXX), a 13-digit national/tax ID or a 15-digit e-wallet ID. */
export function parsePromptPayId(raw: string): PromptPayTarget {
  const id = raw.replace(/\D/g, "");
  if (/^0\d{9}$/.test(id)) return { kind: "mobile", id };
  if (/^\d{13}$/.test(id)) return { kind: "nationalId", id };
  if (/^\d{15}$/.test(id)) return { kind: "eWallet", id };
  throw new Error("PromptPay ID ต้องเป็นเบอร์มือถือ 10 หลัก, เลขประจำตัว 13 หลัก หรือ e-Wallet 15 หลัก");
}

/**
 * @param amountSatang amount in satang; omit for a static QR (payer types the amount)
 */
export function promptPayPayload(target: PromptPayTarget, amountSatang?: bigint): string {
  const account =
    target.kind === "mobile"
      ? field("01", ("0000000000000" + "66" + target.id.slice(1)).slice(-13))
      : target.kind === "nationalId"
        ? field("02", target.id)
        : field("03", target.id);

  let payload =
    field("00", "01") +
    field("01", amountSatang === undefined ? "11" : "12") +
    field("29", field("00", AID_PROMPTPAY) + account) +
    field("58", "TH") +
    field("53", "764");
  if (amountSatang !== undefined) {
    if (amountSatang <= 0n) throw new Error("amount must be positive");
    payload += field("54", formatBaht(amountSatang, false));
  }
  payload += "6304";
  return payload + crc16(payload);
}

/** 123456n → "1,234.56" (or "1234.56" without grouping). */
export function formatBaht(satang: bigint, group = true): string {
  const neg = satang < 0n;
  const abs = neg ? -satang : satang;
  const baht = (abs / 100n).toString();
  const frac = (abs % 100n).toString().padStart(2, "0");
  const grouped = group ? baht.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : baht;
  return `${neg ? "-" : ""}${grouped}.${frac}`;
}

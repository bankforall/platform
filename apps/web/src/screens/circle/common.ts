import type { CircleDetail, PaymentStatus } from "@bankforall/shared";
import { sameAddress } from "@/lib/format";

export type Round = CircleDetail["rounds"][number];
export type Member = CircleDetail["members"][number];

export function currentRound(c: CircleDetail): Round | undefined {
  return c.rounds.find((r) => r.number === c.currentRound);
}

export function memberByAddress(c: CircleDetail, address: string | null | undefined): Member | undefined {
  return c.members.find((m) => sameAddress(m.address, address));
}

export function nameOf(c: CircleDetail, address: string | null | undefined): string {
  return memberByAddress(c, address)?.displayName ?? "–";
}

export const paymentLabel: Record<PaymentStatus, { text: string; tone: "neutral" | "primary" | "success" | "warn" | "danger" }> = {
  NONE: { text: "ยังไม่จ่าย", tone: "warn" },
  DECLARED: { text: "แจ้งโอนแล้ว", tone: "primary" },
  ATTESTED: { text: "ตรวจสลิปกับธนาคารแล้ว ✓", tone: "success" },
  CONFIRMED: { text: "ผู้รับยืนยันแล้ว", tone: "success" },
  DEFAULTED: { text: "ผิดนัด", tone: "danger" },
};

/** Settled for the round: confirmed by the recipient (or accepted after the review time) or bank-verified. */
export function isSettled(status: PaymentStatus): boolean {
  return status === "CONFIRMED" || status === "ATTESTED";
}

export function txUrl(explorer: string | null | undefined, hash: string | null | undefined): string | null {
  return explorer && hash ? `${explorer.replace(/\/$/, "")}/tx/${hash}` : null;
}

import { LEGAL_CAPS } from "@bankforall/shared";
import { dateTime, percent } from "@/lib/format";
import { useNow } from "./widgets";

/** Annualised interest cap as shown to users, e.g. "15% ต่อปี" (decisions D3). */
export const annualCapLabel = `${percent(LEGAL_CAPS.maxAnnualRateBps)} ต่อปี`;

/** Why a user with unpaid defaults cannot create or join circles (decisions D5). */
export function defaultsMessage(count: number): string {
  return `มีหนี้ผิดนัดค้าง ${count} รายการ — ชำระย้อนหลังให้ผู้รับยืนยันก่อน จึงจะสร้างหรือเข้าวงใหม่ได้`;
}

export function DefaultsBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <p className="mb-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
      {defaultsMessage(count)}
    </p>
  );
}

/** Small badge for members whose reputation reaches the circle's trusted level (decisions D2). */
export function TrustedBadge() {
  return (
    <span className="ml-1 inline-flex items-center rounded-md bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">
      สมาชิกที่น่าเชื่อถือ
    </span>
  );
}

/** Open circles close automatically (decisions D4): anyone — in practice the system — cancels them after `openUntil`. */
export function OpenUntilNotice({ openUntil }: { openUntil: number | null }) {
  const now = useNow(30_000);
  if (!openUntil) return null;
  return now < openUntil ? (
    <p className="text-sm text-ink-muted">ปิดรับสมาชิกอัตโนมัติ {dateTime(openUntil)} — ถ้าสมาชิกยังไม่ครบและยังไม่เริ่มวง วงจะถูกยกเลิก</p>
  ) : (
    <p className="rounded-xl bg-warn-soft p-3 text-sm text-amber-800" role="status">
      เลยกำหนดปิดรับสมาชิกแล้ว ({dateTime(openUntil)}) วงนี้จะถูกระบบยกเลิกโดยอัตโนมัติ ไม่มีเงินเคลื่อนที่เพราะยังไม่เริ่มวง
    </p>
  );
}

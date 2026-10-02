import { CircleType, seatPayment, type CircleRules } from "@bankforall/shared";
import { baht } from "@/lib/format";
import { cx } from "./ui";

/** Figma "Lending fix peer share Sit in": each seat's per-round payment, total and receive. */
export function SeatPicker({
  principal,
  maxMembers,
  fixRateBps,
  taken,
  value,
  onChange,
  ownerName,
}: {
  principal: bigint;
  maxMembers: number;
  fixRateBps: number;
  taken: number[];
  value: number | null;
  onChange: (seat: number) => void;
  ownerName?: (seat: number) => string | undefined;
}) {
  const rules: CircleRules = { type: CircleType.Fix, principal, maxMembers, hostTakesFirst: false, fixRateBps };
  const receive = principal * BigInt(maxMembers);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">เลือกที่นั่ง (ลำดับที่ได้รับเงิน)</legend>
      <div className="space-y-2" role="radiogroup">
        {Array.from({ length: maxMembers }, (_, seat) => {
          const pay = seatPayment(rules, seat);
          const isTaken = taken.includes(seat);
          const selected = value === seat;
          return (
            <button
              key={seat}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isTaken}
              onClick={() => onChange(seat)}
              className={cx(
                "flex w-full items-center justify-between rounded-2xl border-2 bg-white p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                selected ? "border-primary bg-primary-soft" : "border-transparent shadow-xs",
                isTaken && "opacity-60",
              )}
            >
              <span>
                <span className="block text-lg font-semibold text-ink">
                  {seat + 1}. {baht(pay)} บาท<span className="text-xs font-normal text-ink-muted"> /งวด</span>
                </span>
                <span className="block text-xs text-ink-muted">
                  จ่ายรวม {baht(pay * BigInt(maxMembers))} · ได้รับ {baht(receive)} · รับงวดที่ {seat + 1}
                </span>
              </span>
              <span
                className={cx(
                  "rounded-lg px-3 py-1 text-xs font-semibold",
                  isTaken ? "bg-gray-200 text-gray-600" : selected ? "bg-primary text-white" : "bg-success-soft text-success",
                )}
              >
                {isTaken ? ownerName?.(seat) ?? "จองแล้ว" : selected ? "เลือกแล้ว" : "ว่าง"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        * "ได้รับ" รวมส่วนของคุณเองในงวดที่รับ ยอดที่โอนเข้าจริงจากสมาชิกคนอื่น = ได้รับ − ยอดต่องวดของคุณ
      </p>
    </fieldset>
  );
}

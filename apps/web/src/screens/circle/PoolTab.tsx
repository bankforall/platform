import { Card, Chip, SectionTitle, cx } from "@/components/ui";
import { Donut } from "@/components/widgets";
import { baht, date } from "@/lib/format";
import { currentRound, nameOf } from "./common";
import type { TabProps } from "./CircleDetail";

export default function PoolTab({ circle }: TabProps) {
  const round = currentRound(circle);
  const principal = BigInt(circle.principal);

  // Contribution per member this round (decided rounds use real dues; otherwise principal).
  const slices = circle.members.map((m) => {
    const p = round?.payments.find((x) => x.payer.toLowerCase() === m.address.toLowerCase());
    const amount = p?.amount ? BigInt(p.amount) : round?.recipient?.toLowerCase() === m.address.toLowerCase() ? 0n : principal;
    return { label: m.displayName, value: Number(amount) };
  });
  const total = slices.reduce((a, s) => a + s.value, 0);

  return (
    <div>
      <Card>
        <p className="text-sm text-ink-muted">
          กองกลาง {circle.maxMembers}/{baht(circle.principal)}
        </p>
        <Donut
          slices={slices}
          center={
            <>
              <span className="text-xs text-ink-muted">งวด {circle.currentRound || "-"}</span>
              <span className="text-xl font-semibold text-ink">฿{baht(BigInt(total))}</span>
            </>
          }
        />
      </Card>

      <SectionTitle>
        ไทม์ไลน์ {circle.currentRound}/{circle.maxMembers}
      </SectionTitle>
      <ol className="relative space-y-3 border-l-2 border-primary/20 pl-5">
        {Array.from({ length: circle.maxMembers }, (_, i) => {
          const n = i + 1;
          const r = circle.rounds.find((x) => x.number === n);
          const isCurrent = n === circle.currentRound && circle.status === "ACTIVE";
          const done = !!r && (n < circle.currentRound || circle.status === "COMPLETED");
          const confirmed = r?.payments.filter((p) => p.status === "CONFIRMED").length ?? 0;
          return (
            <li key={n} className="relative">
              <span
                className={cx(
                  "absolute -left-[29px] top-3 h-4 w-4 rounded-full border-2",
                  done ? "border-success bg-success" : isCurrent ? "border-primary bg-white" : "border-gray-300 bg-white",
                )}
                aria-hidden
              />
              <div className={cx("rounded-2xl bg-white p-3 shadow-sm", isCurrent && "ring-2 ring-primary")}>
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink">งวดที่ {n}</p>
                  {done ? <Chip tone="success">เสร็จ</Chip> : isCurrent ? <Chip tone="primary">งวดปัจจุบัน</Chip> : <Chip>รอ</Chip>}
                </div>
                {r ? (
                  <div className="mt-1 text-sm text-ink-muted">
                    <p>เริ่ม {date(r.startedAt)}</p>
                    {r.decided ? (
                      <p>
                        ผู้รับ: <strong className="text-ink">{r.recipientName ?? nameOf(circle, r.recipient)}</strong>
                        {BigInt(r.winningBid) > 0n && ` · ประมูล ${baht(r.winningBid)} บาท`}
                      </p>
                    ) : (
                      <p>กำลังประมูล</p>
                    )}
                    {r.decided && (
                      <p>
                        ชำระแล้ว {confirmed}/{circle.maxMembers - 1} คน
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-ink-muted">ยังไม่เริ่ม</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

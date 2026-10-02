import { Link } from "react-router-dom";
import { CircleType, type CircleStatus, type CircleSummary } from "@bankforall/shared";
import { Chip } from "./ui";
import { baht, percent, periodLabel } from "@/lib/format";

export const statusLabel: Record<CircleStatus, { text: string; tone: "neutral" | "primary" | "success" | "warn" | "danger" }> = {
  DRAFT: { text: "กำลังสร้าง", tone: "neutral" },
  OPEN: { text: "เปิดรับสมาชิก", tone: "primary" },
  ACTIVE: { text: "กำลังเล่น", tone: "success" },
  COMPLETED: { text: "จบแล้ว", tone: "neutral" },
  CANCELLED: { text: "ยกเลิก", tone: "danger" },
  FAILED: { text: "สร้างไม่สำเร็จ", tone: "danger" },
};

export const typeShort: Record<CircleType, string> = {
  [CircleType.Fix]: "เลือกที่นั่ง",
  [CircleType.Float]: "ดอกตาม",
  [CircleType.Discount]: "ดอกหัก",
};

/** Figma "Lending peer share dashboard" room card. */
export function CircleCard({ circle, to }: { circle: CircleSummary; to?: string }) {
  const pool = BigInt(circle.principal) * BigInt(circle.maxMembers);
  const filled = (circle.memberCount / circle.maxMembers) * 100;
  const st = statusLabel[circle.status];
  return (
    <Link
      to={to ?? `/circles/${circle.id}`}
      className="block rounded-2xl bg-white p-4 shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-ink">{circle.name}</h3>
          <p className="text-xs text-ink-muted">
            นายวง {circle.host.displayName} · {typeShort[circle.type]}
            {circle.type === CircleType.Fix && circle.fixRateBps > 0 && ` ±${percent(circle.fixRateBps)}`}
            {circle.isPrivate && " · 🔒"}
          </p>
        </div>
        <Chip tone={st.tone}>{st.text}</Chip>
      </div>
      <div className="mt-3 flex items-baseline justify-between text-sm">
        <span className="text-ink-muted">
          {baht(circle.principal)} บาท / {periodLabel(circle.period)}
        </span>
        <span className="font-medium text-ink">
          {circle.status === "ACTIVE" || circle.status === "COMPLETED"
            ? `งวด ${circle.currentRound}/${circle.maxMembers}`
            : `${circle.memberCount}/${circle.maxMembers} มือ`}
        </span>
      </div>
      <div className="mt-2 h-7 overflow-hidden rounded-full bg-surface" aria-hidden>
        <div className="flex h-full items-center rounded-full bg-primary pl-3 text-xs font-semibold text-white" style={{ width: `${Math.max(filled, 28)}%` }}>
          กองกลาง {baht(pool)}
        </div>
      </div>
      {circle.me?.dueNow && circle.me.dueNow.status !== "CONFIRMED" && (
        <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium text-amber-800">
          งวดนี้ต้องจ่าย {baht(circle.me.dueNow.amount)} บาท ให้ {circle.me.dueNow.to}
        </p>
      )}
    </Link>
  );
}

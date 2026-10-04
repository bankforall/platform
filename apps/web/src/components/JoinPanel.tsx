import { useState } from "react";
import { useNavigate } from "react-router";
import { CircleType, type CircleSummary } from "@bankforall/shared";
import { api } from "@/api/endpoints";
import { useIntent } from "@/hooks/useIntent";
import { useMe } from "@/hooks/session";
import { SeatPicker } from "./SeatPicker";
import { Button, Card } from "./ui";
import { baht, periodLabel } from "@/lib/format";

/** Join an open circle; Fix circles pick a seat first. */
export function JoinPanel({ circle, inviteCode }: { circle: CircleSummary; inviteCode?: string }) {
  const me = useMe().data;
  const { run } = useIntent();
  const navigate = useNavigate();
  const isFix = circle.type === CircleType.Fix;
  const [seat, setSeat] = useState<number | null>(isFix ? null : 0);

  if (circle.status !== "OPEN") {
    return <Card><p className="text-sm text-ink-muted">วงนี้ไม่เปิดรับสมาชิกแล้ว</p></Card>;
  }
  if (circle.memberCount >= circle.maxMembers) {
    return <Card><p className="text-sm text-ink-muted">วงนี้สมาชิกเต็มแล้ว</p></Card>;
  }
  const kycOk = me?.kycStatus === "APPROVED";

  const join = async () => {
    if (seat === null) return;
    const res = await run({
      title: "เข้าร่วมวง",
      prepare: () => api.prepareJoin(circle.id, seat, inviteCode),
      expect: { kind: "join", circle: circle.address, seat },
      display: { circleName: circle.name, fixSeats: isFix },
      successMessage: `เข้าร่วมวง ${circle.name} แล้ว`,
    });
    if (res?.status === "CONFIRMED") navigate(`/circles/${circle.id}`, { replace: true });
  };

  return (
    <div className="space-y-4">
      {isFix && (
        <SeatPicker
          principal={BigInt(circle.principal)}
          maxMembers={circle.maxMembers}
          fixRateBps={circle.fixRateBps}
          taken={circle.takenSeats}
          value={seat}
          onChange={setSeat}
        />
      )}
      <Card className="text-sm text-ink-muted">
        เมื่อเข้าร่วม คุณตกลงจ่ายงวดละ {baht(circle.principal)} บาท{isFix ? " (ตามที่นั่ง)" : ""} {periodLabel(circle.period)} จนครบ {circle.maxMembers} งวด
        การผิดนัดจะถูกบันทึกถาวรและลดคะแนนความน่าเชื่อถือ
      </Card>
      {!kycOk && (
        <p className="rounded-xl bg-warn-soft p-3 text-sm text-amber-800">ต้องยืนยันตัวตนผ่านก่อนจึงเข้าร่วมวงได้</p>
      )}
      <Button block disabled={seat === null || !kycOk} onClick={() => void join()}>
        {isFix && seat !== null ? `จองที่นั่ง ${seat + 1} และเข้าร่วม` : "เข้าร่วมวง"}
      </Button>
    </div>
  );
}

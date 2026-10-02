import { useNavigate } from "react-router";
import { CircleType } from "@bankforall/shared";
import { api } from "@/api/endpoints";
import { useIntent } from "@/hooks/useIntent";
import { useToast } from "@/components/overlay";
import { Avatar, Button, Card, Chip, SectionTitle } from "@/components/ui";
import { sameAddress } from "@/lib/format";
import type { TabProps } from "./CircleDetail";

function HostPanel({ circle }: TabProps) {
  const { run } = useIntent();
  const toast = useToast();
  const navigate = useNavigate();
  const full = circle.memberCount >= circle.maxMembers;
  const link = circle.inviteCode ? `${window.location.origin}/join/${circle.inviteCode}` : null;

  const share = async () => {
    if (!link) return;
    const text = `เข้าร่วมวงแชร์ "${circle.name}" ใน Bank For All\nรหัสเชิญ: ${circle.inviteCode}\n${link}`;
    try {
      if (navigator.share) await navigator.share({ title: circle.name, text, url: link });
      else {
        await navigator.clipboard.writeText(text);
        toast("คัดลอกคำเชิญแล้ว", "success");
      }
    } catch {
      /* user cancelled */
    }
  };

  return (
    <Card className="space-y-3">
      <h3 className="font-semibold text-ink">สำหรับนายวง</h3>
      {circle.inviteCode && (
        <div className="flex items-center justify-between rounded-xl bg-surface p-3">
          <div>
            <p className="text-xs text-ink-muted">รหัสเชิญ</p>
            <p className="font-mono text-lg font-semibold tracking-wider text-ink" data-testid="invite-code">
              {circle.inviteCode}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void share()}>
            แชร์คำเชิญ
          </Button>
        </div>
      )}
      <p className="text-sm text-ink-muted">
        {full ? "สมาชิกครบแล้ว เริ่มวงได้เลย งวดแรกจะเปิดทันที" : `รอสมาชิกอีก ${circle.maxMembers - circle.memberCount} คน จึงจะเริ่มวงได้`}
      </p>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={!full}
          onClick={() => void run({ title: "เริ่มวง", prepare: () => api.prepareStart(circle.id), successMessage: "เริ่มวงแล้ว งวดที่ 1 เปิดแล้ว" })}
        >
          เริ่มวง
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-danger"
          onClick={async () => {
            if (!window.confirm("ยกเลิกวงนี้? ทำย้อนกลับไม่ได้")) return;
            const r = await run({ title: "ยกเลิกวง", prepare: () => api.prepareCancel(circle.id), successMessage: "ยกเลิกวงแล้ว" });
            if (r?.status === "CONFIRMED") navigate("/circles");
          }}
        >
          ยกเลิกวง
        </Button>
      </div>
    </Card>
  );
}

export default function MembersTab(props: TabProps) {
  const { circle, myAddress } = props;
  const isFix = circle.type === CircleType.Fix;
  const members = [...circle.members].sort((a, b) => (isFix ? a.seat - b.seat : a.index - b.index));

  return (
    <div>
      {circle.me?.isHost && circle.status === "OPEN" && <HostPanel {...props} />}
      {circle.status === "OPEN" && !circle.me?.isHost && (
        <Card>
          <p className="text-sm text-ink-muted">
            รอสมาชิกครบ {circle.maxMembers} คน ({circle.memberCount}/{circle.maxMembers}) แล้วนายวงจะเริ่มวง
          </p>
        </Card>
      )}

      <SectionTitle>สมาชิก</SectionTitle>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2" aria-label="สมาชิกในวง">
        {members.map((m) => (
          <li key={m.address} className="flex w-28 shrink-0 flex-col items-center rounded-2xl bg-white p-3 text-center shadow-xs">
            <Avatar name={m.displayName} src={m.pictureUrl} size={56} />
            <p className="mt-2 w-full truncate text-sm font-medium text-ink">{sameAddress(m.address, myAddress) ? "คุณ" : m.displayName}</p>
            <p className="text-xs text-ink-muted">{isFix ? `ที่นั่ง ${m.seat + 1}` : `มือที่ ${m.index + 1}`}</p>
          </li>
        ))}
      </ul>

      <SectionTitle>รายละเอียด</SectionTitle>
      <ul className="divide-y divide-gray-100 rounded-2xl bg-white shadow-xs">
        {members.map((m) => (
          <li key={m.address} className="flex items-center gap-3 p-3">
            <Avatar name={m.displayName} src={m.pictureUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">
                {m.displayName}
                {sameAddress(m.address, myAddress) && " (คุณ)"}
                {m.index === 0 && <span className="ml-1 text-xs text-primary">· นายวง</span>}
              </p>
              <p className="text-xs text-ink-muted">คะแนนความน่าเชื่อถือ {m.reputation}</p>
            </div>
            {m.defaulted ? (
              <Chip tone="danger">ผิดนัด</Chip>
            ) : m.hasWon ? (
              <Chip>ได้รับแล้ว{m.wonRound ? ` งวด ${m.wonRound}` : ""}</Chip>
            ) : circle.status === "ACTIVE" ? (
              <Chip tone="success">{isFix ? `รอรับงวด ${m.seat + 1}` : "ประมูลได้"}</Chip>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

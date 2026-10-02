import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useMe } from "@/hooks/session";
import { Screen } from "@/components/layout";
import { CircleCard } from "@/components/CircleCard";
import { Countdown } from "@/components/widgets";
import { Avatar, Card, EmptyState, ErrorState, LinkButton, Loading, SectionTitle } from "@/components/ui";
import { baht, date } from "@/lib/format";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "สวัสดีตอนเช้า" : h < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
}

export default function Home() {
  const me = useMe().data!;
  const circles = useQuery({ queryKey: qk.myCircles, queryFn: api.myCircles });

  const dues =
    circles.data
      ?.filter((c) => c.me?.dueNow && c.me.dueNow.status !== "CONFIRMED" && c.me.dueNow.status !== "DEFAULTED")
      .map((c) => ({ circle: c, due: c.me!.dueNow! }))
      .sort((a, b) => a.due.deadline - b.due.deadline) ?? [];
  const next = dues[0];
  const active = circles.data?.filter((c) => c.status === "ACTIVE" || c.status === "OPEN") ?? [];
  const totalDue = dues.reduce((a, d) => a + BigInt(d.due.amount), 0n);

  return (
    <Screen>
      <header className="flex items-center justify-between px-5 pb-2 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <div>
          <p className="text-sm text-ink-muted">{greeting()}</p>
          <h1 className="text-2xl font-semibold text-ink">{me.displayName}</h1>
        </div>
        <Link to="/profile" aria-label="โปรไฟล์">
          <Avatar name={me.displayName} src={me.pictureUrl} size={48} />
        </Link>
      </header>

      <main className="px-4">
        {me.kycStatus === "PENDING" && (
          <p className="mb-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-amber-800">
            กำลังตรวจสอบตัวตน — สร้างหรือเข้าร่วมวงได้หลังผ่านการตรวจสอบ
          </p>
        )}

        <section className="rounded-3xl bg-primary p-5 text-white shadow-lg" aria-label="งวดที่ต้องจ่าย">
          <p className="text-sm text-white/80">ต้องจ่ายงวดนี้ทั้งหมด</p>
          <p className="mt-1 text-4xl font-semibold">฿{baht(totalDue)}</p>
          {next ? (
            <div className="mt-4 rounded-2xl bg-white/15 p-3 text-sm">
              <p>
                ถัดไป: <strong>{baht(next.due.amount)} บาท</strong> ให้ {next.due.to}
              </p>
              <p className="text-white/85">
                วง {next.circle.name} · ภายใน {date(next.due.deadline)} (<Countdown to={next.due.deadline} />)
              </p>
              <Link to={`/circles/${next.circle.id}?tab=payment`} className="mt-3 inline-block rounded-xl bg-white px-4 py-2 font-semibold text-primary">
                จ่ายเลย
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-sm text-white/85">ไม่มียอดค้างจ่าย 🎉</p>
          )}
        </section>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <LinkButton to="/circles/new" variant="secondary">
            + สร้างวง
          </LinkButton>
          <LinkButton to="/circles?tab=discover" variant="secondary">
            ค้นหาวง
          </LinkButton>
        </div>

        <SectionTitle action={<Link to="/circles" className="text-sm font-medium text-primary">ดูทั้งหมด</Link>}>วงของฉัน</SectionTitle>
        {circles.isLoading ? (
          <Loading />
        ) : circles.isError ? (
          <ErrorState message={errorMessage(circles.error)} onRetry={() => void circles.refetch()} />
        ) : active.length === 0 ? (
          <Card>
            <EmptyState title="ยังไม่มีวงแชร์">สร้างวงใหม่ หรือขอรหัสเชิญจากนายวงที่คุณรู้จัก</EmptyState>
          </Card>
        ) : (
          <div className="space-y-3">
            {active.map((c) => (
              <CircleCard key={c.id} circle={c} />
            ))}
          </div>
        )}

        <SectionTitle>คะแนนความน่าเชื่อถือ</SectionTitle>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-semibold text-primary">{me.reputation}</p>
              <p className="text-xs text-ink-muted">เพิ่มขึ้นเมื่อจ่ายตรงเวลา ลดลงเมื่อผิดนัด</p>
            </div>
            <Link to="/how-it-works" className="text-sm font-medium text-primary">
              วิธีการทำงาน
            </Link>
          </div>
        </Card>
      </main>
    </Screen>
  );
}

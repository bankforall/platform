import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useMe } from "@/hooks/session";
import { LinkButton } from "@/components/ui";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center text-white ${className}`}>
      <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const a = (i / 8) * Math.PI * 2;
          return <circle key={i} cx={36 + Math.cos(a) * 24} cy={36 + Math.sin(a) * 24} r={6.5} fill="currentColor" opacity={0.55 + (i % 4) * 0.15} />;
        })}
      </svg>
      <p className="mt-3 text-5xl font-semibold tracking-tight">Bank</p>
      <p className="text-lg text-white/80">For All</p>
    </div>
  );
}

export default function Welcome() {
  const me = useMe();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  if (me.data) return <Navigate to={next} replace />;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-app flex-col bg-primary px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-16">
      <div className="flex flex-1 flex-col items-center justify-center text-center text-white">
        <Logo />
        <h1 className="mt-10 text-2xl font-semibold">วงแชร์ที่โปร่งใส ไม่ต้องพึ่งท้าวแชร์</h1>
        <p className="mt-3 text-white/85">
          สร้างหรือเข้าร่วมวงแชร์กับคนที่คุณรู้จัก ระบบช่วยตัดสินการประมูล เตือนกำหนดจ่าย และบันทึกทุกการโอนเป็นหลักฐานถาวร
        </p>
        <ul className="mt-6 space-y-2 text-left text-sm text-white/90">
          <li>✓ โอนกันเองผ่านพร้อมเพย์ — ระบบไม่ถือเงินของคุณ</li>
          <li>✓ ประมูลแบบปิดซอง ยุติธรรม ตรวจสอบได้</li>
          <li>✓ มีหลักฐานทุกงวด ใช้ยืนยันได้เมื่อมีปัญหา</li>
        </ul>
      </div>
      <div className="space-y-3">
        <LinkButton to={`/login?next=${encodeURIComponent(next)}`} variant="white" block>
          เริ่มต้นใช้งาน
        </LinkButton>
        <Link to="/how-it-works" className="block py-2 text-center text-sm font-medium text-white underline-offset-4 hover:underline">
          วงแชร์ทำงานอย่างไร?
        </Link>
      </div>
    </main>
  );
}

import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { cx } from "./ui";

/** Mobile frame used by every screen. */
export function Screen({ children, nav = true, className }: { children: ReactNode; nav?: boolean; className?: string }) {
  return (
    <div className={cx("mx-auto min-h-[100dvh] max-w-app bg-surface", nav && "pb-24", className)}>
      {children}
      {nav && <BottomNav />}
    </div>
  );
}

/** Purple header with rounded bottom corners (Figma). */
export function Header({
  title,
  subtitle,
  back,
  right,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: boolean | string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="rounded-b-3xl bg-primary px-5 pb-6 pt-[max(1rem,env(safe-area-inset-top))] text-white">
      <div className="flex min-h-[44px] items-center gap-2">
        {back && (
          <button
            onClick={() => (typeof back === "string" ? navigate(back) : navigate(-1))}
            className="-ml-2 rounded-full p-2 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            aria-label="ย้อนกลับ"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <h1 className="flex-1 truncate text-center text-lg font-semibold">{title}</h1>
        <div className="flex min-w-[36px] justify-end">{right}</div>
      </div>
      {subtitle && <div className="mt-1 text-center text-sm text-white/80">{subtitle}</div>}
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BottomNav() {
  const { data: notifications } = useQuery({ queryKey: qk.notifications, queryFn: api.notifications, staleTime: 30_000 });
  const unread = notifications?.filter((n) => !n.readAt).length ?? 0;
  const items = [
    { to: "/", label: "หน้าแรก", d: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
    { to: "/circles", label: "วงแชร์", d: "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0" },
    { to: "/notifications", label: "แจ้งเตือน", d: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4", badge: unread },
    { to: "/profile", label: "โปรไฟล์", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-app border-t border-gray-100 bg-white pb-[env(safe-area-inset-bottom)]"
      aria-label="เมนูหลัก"
    >
      <ul className="flex">
        {items.map((it) => (
          <li key={it.to} className="flex-1">
            <NavLink
              to={it.to}
              end={it.to === "/"}
              className={({ isActive }) =>
                cx(
                  "relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                  isActive ? "text-primary" : "text-ink-muted",
                )
              }
            >
              <NavIcon d={it.d} />
              {it.label}
              {!!it.badge && (
                <span className="absolute right-1/4 top-1 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] text-white">
                  {it.badge > 9 ? "9+" : it.badge}
                  <span className="sr-only"> รายการที่ยังไม่อ่าน</span>
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

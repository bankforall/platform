import { useEffect, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { cx } from "./ui";
import { duration } from "@/lib/format";

/** Current unix time in seconds, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Countdown({ to, prefix }: { to: number | null | undefined; prefix?: string }) {
  const now = useNow();
  if (!to) return null;
  const left = to - now;
  return (
    <span className={cx("tabular-nums", left <= 0 && "text-danger")}>
      {prefix}
      {left > 0 ? duration(left) : "หมดเวลาแล้ว"}
    </span>
  );
}

export function QrCode({ payload, size = 220, label }: { payload: string; size?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, payload, { width: size, margin: 1, errorCorrectionLevel: "M" }).catch(() =>
      setErr("สร้าง QR ไม่สำเร็จ"),
    );
  }, [payload, size]);
  return err ? (
    <p className="text-sm text-danger">{err}</p>
  ) : (
    <canvas ref={ref} width={size} height={size} role="img" aria-label={label} className="rounded-xl bg-white" />
  );
}

const DONUT_COLORS = ["#7165E3", "#3F3A8C", "#5D6A9E", "#A99CF5", "#1C1939", "#C9C2FA", "#665AD9", "#8E85EA"];

/** Simple SVG donut chart with a centre label (Figma "Pool"). */
export function Donut({
  slices,
  center,
  size = 200,
}: {
  slices: { label: string; value: number }[];
  center: ReactNode;
  size?: number;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const r = 70;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <figure className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="สัดส่วนเงินกองกลางของสมาชิก">
          <circle cx="100" cy="100" r={r} fill="none" stroke="#EEECFC" strokeWidth="36" />
          {slices.map((s, i) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={i}
                cx="100"
                cy="100"
                r={r}
                fill="none"
                stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
                strokeWidth="36"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 100 100)"
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
      </div>
      <figcaption className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-ink">
        {slices.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  dark,
}: {
  tabs: { id: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  dark?: boolean;
}) {
  return (
    <div role="tablist" className="flex justify-between gap-2">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cx(
              "flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
              dark
                ? active
                  ? "bg-primary-active text-white"
                  : "bg-primary-dim text-white/70"
                : active
                  ? "bg-primary text-white"
                  : "bg-white text-ink-muted",
            )}
          >
            {t.icon && <span aria-hidden className="text-lg">{t.icon}</span>}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

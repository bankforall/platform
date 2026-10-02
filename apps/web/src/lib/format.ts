import { formatBaht } from "@bankforall/shared";

/** "123456" satang → "1,234.56" (drops ".00"). */
export function baht(satang: string | bigint | null | undefined): string {
  if (satang === null || satang === undefined || satang === "") return "–";
  const s = formatBaht(BigInt(satang));
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

/** "1,234.5" baht typed by a user → satang bigint, or null if invalid. */
export function parseBaht(input: string): bigint | null {
  const clean = input.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, "0"));
}

const dateFmt = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Unix seconds → "2 ต.ค. 69". */
export function date(unix: number | null | undefined): string {
  return unix ? dateFmt.format(new Date(unix * 1000)) : "–";
}

export function dateTime(unix: number | null | undefined): string {
  return unix ? dateTimeFmt.format(new Date(unix * 1000)) : "–";
}

/** Seconds → "3 วัน 4 ชม." (two largest units). */
export function duration(seconds: number): string {
  if (seconds <= 0) return "หมดเวลา";
  const units: [number, string][] = [
    [86400, "วัน"],
    [3600, "ชม."],
    [60, "นาที"],
    [1, "วินาที"],
  ];
  const parts: string[] = [];
  let rest = Math.floor(seconds);
  for (const [size, label] of units) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)} ${label}`);
      rest %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

/** Period in seconds → "ทุกเดือน"/"ทุก 7 วัน". */
export function periodLabel(seconds: number): string {
  const days = Math.round(seconds / 86400);
  if (days === 1) return "ทุกวัน";
  if (days === 7) return "ทุกสัปดาห์";
  if (days === 14) return "ทุก 2 สัปดาห์";
  if (days >= 28 && days <= 31) return "ทุกเดือน";
  return `ทุก ${days} วัน`;
}

export function shortAddress(a: string | null | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "–";
}

export function percent(bps: number): string {
  return `${(bps / 100).toLocaleString("th-TH", { maximumFractionDigits: 2 })}%`;
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

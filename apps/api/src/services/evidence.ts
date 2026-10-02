import { CircleType, circleTypeLabel, formatBaht } from "@bankforall/shared";
import type { Ctx } from "../context.js";
import { detailView } from "./circles.js";
import type { User } from "@prisma/client";
import { forbidden } from "../errors.js";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const statusLabel: Record<string, string> = {
  NONE: "ยังไม่ชำระ",
  DECLARED: "แจ้งโอนแล้ว",
  ATTESTED: "ตรวจสลิปแล้ว",
  CONFIRMED: "ผู้รับยืนยันแล้ว",
  DEFAULTED: "ผิดนัด",
};

/**
 * Printable evidence report of a circle. Every row links to the public transaction that recorded
 * it, so anyone (e.g. a court) can check it independently of this company's database.
 */
export async function evidenceHtml(ctx: Ctx, user: User, circleId: string): Promise<string> {
  const c = await detailView(ctx, circleId, user);
  if (!c.me && user.role !== "ADMIN") throw forbidden();
  const events = c.address
    ? await ctx.db.chainEvent.findMany({
        where: { address: c.address },
        orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      })
    : [];
  // only disputes that were actually signed and recorded on-chain
  const disputes = await ctx.db.dispute.findMany({
    where: { circleId, txHash: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const tx = (hash: string | null) =>
    hash
      ? ctx.config.EXPLORER_URL
        ? `<a href="${esc(ctx.config.EXPLORER_URL)}/tx/${esc(hash)}">${esc(hash.slice(0, 18))}…</a>`
        : `<code>${esc(hash)}</code>`
      : "-";
  const when = (unix: number | null) =>
    unix ? new Date(unix * 1000).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "-";
  const nameOf = (a: string) => c.members.find((m) => m.address === a)?.displayName ?? a;

  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>รายงานหลักฐาน — ${esc(c.name)}</title>
<style>
body{font-family:"IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif;color:#1C1939;margin:24px;font-size:13px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;border-bottom:2px solid #7165E3;padding-bottom:4px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#F7F7F7}code{font-size:11px;word-break:break-all}.muted{color:#666}
@media print{a{color:inherit;text-decoration:none}button{display:none}}
</style></head><body>
<button onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button>
<h1>รายงานหลักฐานวงแชร์ "${esc(c.name)}"</h1>
<p class="muted">ออกโดย Bank For All เมื่อ ${esc(new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }))} สำหรับ ${esc(user.displayName)}<br>
ข้อมูลทุกรายการด้านล่างถูกบันทึกบนเครือข่ายสาธารณะ (chain id ${ctx.chain.chainId}) ที่สัญญา <code>${esc(c.address)}</code>
และตรวจสอบได้ด้วยเลขอ้างอิงธุรกรรม (tx hash) ของแต่ละรายการ</p>

<h2>รายละเอียดวง</h2>
<table>
<tr><th>ประเภท</th><td>${esc(circleTypeLabel[c.type])}${c.type === CircleType.Fix && c.fixRateBps ? ` ±${c.fixRateBps / 100}%` : ""}</td></tr>
<tr><th>เงินต้นต่องวด</th><td>${formatBaht(BigInt(c.principal))} บาท</td></tr>
<tr><th>จำนวนสมาชิก/รอบ</th><td>${c.maxMembers}</td></tr>
<tr><th>นายวง</th><td>${esc(c.host.displayName)}</td></tr>
<tr><th>สถานะ</th><td>${esc(c.status)}</td></tr>
</table>

<h2>สมาชิก</h2>
<table><tr><th>#</th><th>ชื่อ</th><th>ที่นั่ง</th><th>ได้รับเงินรอบ</th><th>ดอก/ส่วนลดที่ชนะ</th><th>ผิดนัด</th><th>ที่อยู่บนเครือข่าย</th></tr>
${c.members
  .map(
    (m) =>
      `<tr><td>${m.index + 1}</td><td>${esc(m.displayName)}</td><td>${m.seat + 1}</td><td>${m.wonRound ?? "-"}</td><td>${formatBaht(BigInt(m.wonBid))}</td><td>${m.defaulted ? "ใช่" : "-"}</td><td><code>${esc(m.address)}</code></td></tr>`,
  )
  .join("")}
</table>

<h2>การชำระเงินแต่ละรอบ</h2>
${c.rounds
  .map(
    (r) => `<p><b>รอบที่ ${r.number}</b> — ผู้รับ: ${esc(r.recipientName ?? "-")} · ดอก/ส่วนลดที่ชนะ ${formatBaht(BigInt(r.winningBid))} บาท · ครบกำหนด ${esc(when(r.paymentDeadline))}</p>
<table><tr><th>ผู้จ่าย</th><th>ยอด (บาท)</th><th>สถานะ</th><th>อ้างอิง</th></tr>
${r.payments
  .map(
    (p) =>
      `<tr><td>${esc(p.payerName)}</td><td>${p.amount ? formatBaht(BigInt(p.amount)) : "-"}</td><td>${esc(statusLabel[p.status])}</td><td>${tx(p.txHash)}</td></tr>`,
  )
  .join("")}</table>`,
  )
  .join("")}

${
  disputes.length
    ? `<h2>การแจ้งปัญหา</h2><table><tr><th>รอบ</th><th>เวลา</th><th>รายละเอียด</th><th>อ้างอิง</th></tr>${disputes
        .map(
          (d) =>
            `<tr><td>${d.round}</td><td>${esc(d.createdAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }))}</td><td>${esc(d.reason)}<br><code class="muted">hash ${esc(d.reasonHash)}</code></td><td>${tx(d.txHash)}</td></tr>`,
        )
        .join("")}</table>`
    : ""
}

<h2>บันทึกเหตุการณ์ทั้งหมด (${events.length})</h2>
<p class="muted">จำนวนเงินในตารางนี้เป็นหน่วยสตางค์</p>
<table><tr><th>เวลา</th><th>เหตุการณ์</th><th>รายละเอียด</th><th>อ้างอิง</th></tr>
${events
  .map((e) => {
    const args = e.args as Record<string, string>;
    const pretty = Object.entries(args)
      .map(([k, v]) => `${k}: ${typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? nameOf(v.toLowerCase()) : v}`)
      .join(", ");
    return `<tr><td>${esc(e.blockTime.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }))}</td><td>${esc(e.name)}</td><td>${esc(pretty)}</td><td>${tx(e.txHash)}</td></tr>`;
  })
  .join("")}
</table>
</body></html>`;
}

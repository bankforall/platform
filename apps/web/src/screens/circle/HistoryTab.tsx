import { useState } from "react";
import { api } from "@/api/endpoints";
import { useConfig } from "@/hooks/session";
import { useIntent } from "@/hooks/useIntent";
import { Button, Card, Chip, KeyValue, SectionTitle } from "@/components/ui";
import { baht, date } from "@/lib/format";
import { nameOf, paymentLabel, txUrl } from "./common";
import type { TabProps } from "./CircleDetail";

export default function HistoryTab({ circle }: TabProps) {
  const { run } = useIntent();
  const config = useConfig().data;
  const [round, setRound] = useState(circle.currentRound || 1);
  const [reason, setReason] = useState("");
  const rounds = [...circle.rounds].sort((a, b) => b.number - a.number);

  const dispute = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await run({
      title: "แจ้งปัญหา",
      prepare: () => api.prepareDispute(circle.id, round, reason.trim()),
      successMessage: "บันทึกการแจ้งปัญหาแล้ว เจ้าหน้าที่จะติดต่อกลับ",
    });
    if (res?.status === "CONFIRMED") setReason("");
  };

  return (
    <div>
      <Card className="space-y-3">
        <h3 className="font-semibold text-ink">หลักฐานของวง</h3>
        <p className="text-sm text-ink-muted">
          รายงานรวมทุกการเข้าวง ประมูล การโอน การยืนยัน และการผิดนัด พร้อมเลขอ้างอิงที่ตรวจสอบได้ พิมพ์หรือบันทึกเป็น PDF เพื่อใช้เป็นหลักฐาน
        </p>
        <a
          href={api.evidenceUrl(circle.id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-full items-center justify-center rounded-xl bg-primary-soft px-5 py-3 font-semibold text-primary"
        >
          เปิดรายงานหลักฐาน
        </a>
        {circle.explorerUrl && (
          <a href={circle.explorerUrl} target="_blank" rel="noreferrer" className="block text-center text-xs text-ink-muted underline">
            ตรวจสอบบันทึกถาวรของวงนี้
          </a>
        )}
      </Card>

      <SectionTitle>ประวัติแต่ละงวด</SectionTitle>
      {rounds.length === 0 ? (
        <Card><p className="text-sm text-ink-muted">ยังไม่มีงวดที่เริ่ม</p></Card>
      ) : (
        <div className="space-y-3">
          {rounds.map((r) => (
            <details key={r.number} className="rounded-2xl bg-white p-4 shadow-sm" open={r.number === circle.currentRound}>
              <summary className="flex cursor-pointer items-center justify-between font-medium text-ink">
                <span>งวดที่ {r.number}</span>
                <span className="text-sm font-normal text-ink-muted">{date(r.startedAt)}</span>
              </summary>
              <div className="mt-2">
                <KeyValue label="ผู้รับ">{r.decided ? r.recipientName ?? nameOf(circle, r.recipient) : "รอผล"}</KeyValue>
                {BigInt(r.winningBid) > 0n && <KeyValue label="ประมูลชนะที่">{baht(r.winningBid)} บาท</KeyValue>}
                <ul className="mt-2 space-y-1">
                  {r.payments.map((p) => {
                    const link = txUrl(config?.explorerUrl, p.txHash);
                    return (
                      <li key={p.payer} className="flex items-center justify-between text-sm">
                        <span className="text-ink">
                          {p.payerName} {p.amount && <span className="text-ink-muted">· {baht(p.amount)}</span>}
                        </span>
                        <span className="flex items-center gap-2">
                          {link && (
                            <a href={link} target="_blank" rel="noreferrer" className="text-xs text-ink-muted underline">
                              อ้างอิง
                            </a>
                          )}
                          <Chip tone={paymentLabel[p.status].tone}>{paymentLabel[p.status].text}</Chip>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          ))}
        </div>
      )}

      <SectionTitle>แจ้งปัญหา</SectionTitle>
      <form onSubmit={dispute} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm text-ink-muted">เช่น โอนแล้วแต่ผู้รับไม่ยืนยัน หรือยอดไม่ตรง การแจ้งจะถูกบันทึกถาวรและส่งให้เจ้าหน้าที่</p>
        <div>
          <label htmlFor="dispute-round" className="mb-1 block text-sm font-medium text-ink">
            งวดที่
          </label>
          <select
            id="dispute-round"
            value={round}
            onChange={(e) => setRound(Number(e.target.value))}
            className="w-full rounded-xl bg-surface-input px-4 py-3 text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {Array.from({ length: Math.max(circle.currentRound, 1) }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dispute-reason" className="mb-1 block text-sm font-medium text-ink">
            รายละเอียด
          </label>
          <textarea
            id="dispute-reason"
            rows={3}
            value={reason}
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-xl bg-surface-input px-4 py-3 text-ink focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <Button type="submit" variant="secondary" block disabled={reason.trim().length < 5}>
          ส่งเรื่อง
        </Button>
      </form>
    </div>
  );
}

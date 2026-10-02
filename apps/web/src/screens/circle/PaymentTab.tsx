import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useConfig } from "@/hooks/session";
import { useIntent } from "@/hooks/useIntent";
import { Avatar, Button, Card, Chip, ErrorState, KeyValue, Loading, SectionTitle } from "@/components/ui";
import { Countdown, QrCode } from "@/components/widgets";
import { baht, dateTime, sameAddress } from "@/lib/format";
import { currentRound, memberByAddress, nameOf, paymentLabel, txUrl, type Round } from "./common";
import type { TabProps } from "./CircleDetail";

const MAX_SLIP = 8 * 1024 * 1024;

function PayNow({ circle, round }: TabProps & { round: Round }) {
  const { run } = useIntent();
  const qr = useQuery({ queryKey: qk.promptPay(circle.id), queryFn: () => api.promptPay(circle.id) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > MAX_SLIP) return setError("ไฟล์ใหญ่เกิน 8MB");
    if (!file.type.startsWith("image/")) return setError("ต้องเป็นรูปสลิป");
    await run({
      title: "แจ้งโอนเงิน",
      prepare: () => api.preparePayment(circle.id, file),
      successMessage: "แจ้งโอนแล้ว รอผู้รับยืนยัน",
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  if (qr.isLoading) return <Loading />;
  if (qr.isError) return <ErrorState message={errorMessage(qr.error)} onRetry={() => void qr.refetch()} />;
  const data = qr.data!;

  return (
    <Card className="space-y-4">
      <div className="text-center">
        <p className="text-sm text-ink-muted">ยอดที่ต้องโอนงวดนี้</p>
        <p className="text-4xl font-semibold text-ink">฿{baht(data.amount)}</p>
        <p className="mt-1 text-sm text-ink-muted">
          ภายใน {dateTime(round.paymentDeadline)} (<Countdown to={round.paymentDeadline} />)
        </p>
      </div>
      <div className="flex flex-col items-center rounded-2xl bg-surface p-4">
        <p className="mb-2 text-sm font-medium text-ink">สแกนจ่ายผ่านพร้อมเพย์</p>
        <QrCode payload={data.payload} label={`QR พร้อมเพย์ ${baht(data.amount)} บาท ให้ ${data.recipientName}`} />
        <p className="mt-2 text-sm text-ink">
          {data.recipientName} · {data.promptPayMasked}
        </p>
      </div>
      <p className="text-xs text-ink-muted">โอนตรงให้ผู้รับเท่านั้น ระบบไม่รับเงิน เมื่อโอนแล้วอัปโหลดสลิปเพื่อบันทึกเป็นหลักฐาน</p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        id="slip-input"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button block onClick={() => fileRef.current?.click()}>
        โอนแล้ว — อัปโหลดสลิป
      </Button>
    </Card>
  );
}

function RecipientView({ circle, round }: TabProps & { round: Round }) {
  const { run } = useIntent();
  const config = useConfig().data;
  const confirmed = round.payments.filter((p) => p.status === "CONFIRMED").length;
  const total = round.payments.reduce((a, p) => a + (p.amount ? BigInt(p.amount) : 0n), 0n);
  return (
    <div className="space-y-4">
      <Card className="bg-primary text-white">
        <p className="text-sm text-white/85">งวดนี้คุณเป็นผู้รับเงินกองกลาง 🎉</p>
        <p className="mt-1 text-3xl font-semibold">฿{baht(total)}</p>
        <p className="mt-1 text-sm text-white/85">
          ยืนยันแล้ว {confirmed}/{round.payments.length} คน · กำหนดโอน {dateTime(round.paymentDeadline)}
        </p>
      </Card>
      <p className="px-1 text-sm text-ink-muted">ตรวจสอบยอดเงินเข้าบัญชีพร้อมเพย์ของคุณ แล้วกด “ได้รับแล้ว” ทีละคน</p>
      <ul className="space-y-2">
        {round.payments.map((p) => {
          const m = memberByAddress(circle, p.payer);
          const st = paymentLabel[p.status];
          const link = txUrl(config?.explorerUrl, p.txHash);
          return (
            <li key={p.payer} className="rounded-2xl bg-white p-3 shadow-xs">
              <div className="flex items-center gap-3">
                <Avatar name={p.payerName} src={m?.pictureUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{p.payerName}</p>
                  <p className="text-xs text-ink-muted">{p.amount ? `${baht(p.amount)} บาท` : "–"}</p>
                </div>
                <Chip tone={st.tone}>{st.text}</Chip>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="flex gap-3">
                  {p.slipId && (
                    <a href={api.slipUrl(p.slipId)} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
                      ดูสลิป
                    </a>
                  )}
                  {p.slipVerify === "VERIFIED" && <span className="text-success">สลิปตรวจแล้ว ✓</span>}
                  {p.slipVerify === "FAILED" && <span className="text-danger">สลิปไม่ผ่านการตรวจ</span>}
                  {link && (
                    <a href={link} target="_blank" rel="noreferrer" className="text-ink-muted underline">
                      หลักฐาน
                    </a>
                  )}
                </span>
                {p.status !== "CONFIRMED" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      void run({
                        title: "ยืนยันว่าได้รับเงิน",
                        prepare: () => api.prepareConfirm(circle.id, p.payer),
                        successMessage: `ยืนยันการรับเงินจาก ${p.payerName} แล้ว`,
                      })
                    }
                  >
                    ได้รับแล้ว
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function PaymentTab(props: TabProps) {
  const { circle, myAddress } = props;
  const config = useConfig().data;
  const round = currentRound(circle);

  if (circle.status !== "ACTIVE" || !round) {
    return <Card><p className="text-sm text-ink-muted">{circle.status === "OPEN" ? "การชำระเริ่มหลังนายวงเริ่มวง" : "ไม่มีงวดที่ต้องชำระ"}</p></Card>;
  }
  if (!round.decided) {
    return <Card><p className="text-sm text-ink-muted">รอผลการประมูลงวดที่ {round.number} ก่อน จึงจะรู้ว่าต้องโอนให้ใคร</p></Card>;
  }
  if (sameAddress(round.recipient, myAddress)) return <RecipientView {...props} round={round} />;

  const mine = round.payments.find((p) => sameAddress(p.payer, myAddress));
  const status = mine?.status ?? "NONE";
  const st = paymentLabel[status];
  const link = txUrl(config?.explorerUrl, mine?.txHash);

  return (
    <div className="space-y-4">
      <Card>
        <KeyValue label="งวดที่">{round.number}</KeyValue>
        <KeyValue label="ผู้รับ">{round.recipientName ?? nameOf(circle, round.recipient)}</KeyValue>
        <KeyValue label="ยอดของคุณ">{mine?.amount ? `${baht(mine.amount)} บาท` : "–"}</KeyValue>
        <KeyValue label="สถานะ">
          <Chip tone={st.tone}>{st.text}</Chip>
        </KeyValue>
        {round.defaultAfter && status !== "CONFIRMED" && (
          <p className="mt-2 text-xs text-ink-muted">หากผู้รับยังไม่ยืนยันหลัง {dateTime(round.defaultAfter)} จะถูกบันทึกว่าผิดนัด</p>
        )}
      </Card>

      {(status === "NONE" || status === "DEFAULTED") && (
        <>
          {status === "DEFAULTED" && (
            <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">
              คุณถูกบันทึกว่าผิดนัดงวดนี้ โอนให้ผู้รับโดยเร็วที่สุด เมื่อผู้รับยืนยันจะบันทึกว่าชำระล่าช้า
            </p>
          )}
          <PayNow {...props} round={round} />
        </>
      )}
      {(status === "DECLARED" || status === "ATTESTED") && (
        <Card className="space-y-2 text-sm text-ink-muted">
          <p>แจ้งโอนแล้ว รอ {round.recipientName ?? "ผู้รับ"} ยืนยันว่าได้รับเงิน</p>
          {mine?.slipVerify === "VERIFIED" && <p className="text-success">ระบบตรวจสลิปแล้ว ✓</p>}
          {mine?.slipVerify === "FAILED" && <p className="text-danger">ระบบตรวจสลิปไม่ผ่าน ผู้รับจะตรวจยอดเงินเข้าเอง</p>}
          {mine?.slipId && (
            <a href={api.slipUrl(mine.slipId)} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
              ดูสลิปที่ส่ง
            </a>
          )}
        </Card>
      )}
      {status === "CONFIRMED" && (
        <Card className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-2xl text-success" aria-hidden>
            ✓
          </div>
          <p className="mt-2 font-semibold text-ink">ชำระงวดนี้แล้ว</p>
          <p className="text-sm text-ink-muted">บันทึกถาวรแล้ว ✓</p>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-primary underline">
              ดูหลักฐาน
            </a>
          )}
        </Card>
      )}

      <SectionTitle>สถานะสมาชิกงวดนี้</SectionTitle>
      <ul className="divide-y divide-gray-100 rounded-2xl bg-white shadow-xs">
        {round.payments.map((p) => (
          <li key={p.payer} className="flex items-center justify-between p-3 text-sm">
            <span className="text-ink">{p.payerName}</span>
            <Chip tone={paymentLabel[p.status].tone}>{paymentLabel[p.status].text}</Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

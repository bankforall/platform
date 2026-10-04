import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useConfig } from "@/hooks/session";
import { useIntent } from "@/hooks/useIntent";
import { Avatar, Button, Card, Chip, ErrorState, KeyValue, Loading, SectionTitle } from "@/components/ui";
import { Countdown, QrCode, useNow } from "@/components/widgets";
import { baht, dateTime, sameAddress } from "@/lib/format";
import { currentRound, isSettled, memberByAddress, nameOf, paymentLabel, txUrl, type Round } from "./common";
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
      expect: { kind: "declarePayment", circle: circle.address },
      display: { circleName: circle.name, amount: qr.data?.amount },
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
        {round.defaultAfter && (
          <p className="text-xs text-ink-muted">ผ่อนผันได้ถึง {dateTime(round.defaultAfter)} หลังจากนั้นถือว่าผิดนัด</p>
        )}
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
  const now = useNow(30_000);
  const settled = round.payments.filter((p) => isSettled(p.status)).length;
  const total = round.payments.reduce((a, p) => a + (p.amount ? BigInt(p.amount) : 0n), 0n);
  const canReject = !!round.acceptAfter && now <= round.acceptAfter;
  const members = circle.members;

  const confirm = (p: Round["payments"][number]) =>
    void run({
      title: "ยืนยันว่าได้รับเงิน",
      prepare: () => api.prepareConfirm(circle.id, p.payer),
      expect: { kind: "confirmReceipt", circle: circle.address, payer: p.payer },
      display: { circleName: circle.name, members },
      successMessage: `ยืนยันการรับเงินจาก ${p.payerName} แล้ว`,
    });
  const reject = (p: Round["payments"][number]) =>
    void run({
      title: "ยังไม่ได้รับเงิน",
      prepare: () => api.prepareReject(circle.id, p.payer),
      expect: { kind: "rejectPayment", circle: circle.address, payer: p.payer },
      display: { circleName: circle.name, members },
      successMessage: `แจ้ง ${p.payerName} แล้วว่ายังไม่ได้รับเงิน ผู้โอนจะแจ้งโอนใหม่ได้`,
    });

  return (
    <div className="space-y-4">
      <Card className="bg-primary text-white">
        <p className="text-sm text-white/85">งวดนี้คุณเป็นผู้รับเงินกองกลาง 🎉</p>
        <p className="mt-1 text-3xl font-semibold">฿{baht(total)}</p>
        <p className="mt-1 text-sm text-white/85">
          ยืนยันแล้ว {settled}/{round.payments.length} คน · กำหนดโอน {dateTime(round.paymentDeadline)}
        </p>
      </Card>
      <div className="space-y-1 px-1 text-sm text-ink-muted">
        <p>ตรวจยอดเงินเข้าบัญชีพร้อมเพย์ของคุณ แล้วตอบทีละคนว่าได้รับเงินหรือยัง</p>
        {round.acceptAfter && (
          <p>
            {canReject ? (
              <>
                ตอบได้ถึง {dateTime(round.acceptAfter)} — ถ้าไม่ตอบภายในเวลานี้ ระบบจะถือว่าคุณได้รับเงินจากผู้ที่แจ้งโอนแล้ว
              </>
            ) : (
              <>เลยเวลาตรวจสอบแล้ว ({dateTime(round.acceptAfter)}) การแจ้งโอนที่ค้างอยู่ถือว่าได้รับแล้ว</>
            )}
          </p>
        )}
      </div>
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
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {p.slipId && (
                  <a href={api.slipUrl(p.slipId)} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
                    ดูสลิป
                  </a>
                )}
                {p.slipVerify === "FAILED" && <span className="text-danger">สลิปไม่ผ่านการตรวจ</span>}
                {link && (
                  <a href={link} target="_blank" rel="noreferrer" className="text-ink-muted underline">
                    หลักฐาน
                  </a>
                )}
              </div>
              {p.status === "DECLARED" && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => confirm(p)}>
                    ยืนยันได้รับเงิน
                  </Button>
                  {canReject && (
                    <Button size="sm" variant="secondary" className="flex-1" onClick={() => reject(p)}>
                      ยังไม่ได้รับเงิน
                    </Button>
                  )}
                </div>
              )}
              {(p.status === "NONE" || p.status === "DEFAULTED") && (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-muted">ได้รับเป็นเงินสดหรือโอนมาโดยไม่แจ้ง?</span>
                  <Button size="sm" variant="secondary" onClick={() => confirm(p)}>
                    ยืนยันได้รับเงิน
                  </Button>
                </div>
              )}
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
        {round.defaultAfter && status === "NONE" && (
          <p className="mt-2 text-xs text-ink-muted">
            แจ้งโอนพร้อมสลิปได้ถึง {dateTime(round.defaultAfter)} หากยังไม่แจ้งโอนหลังเวลานี้จะถูกบันทึกว่าผิดนัด
          </p>
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
      {status === "DECLARED" && (
        <Card className="space-y-2 text-sm text-ink-muted">
          <p className="font-medium text-ink">แจ้งโอนแล้ว รอผู้รับยืนยัน</p>
          <p>
            {round.recipientName ?? "ผู้รับ"} จะตรวจยอดเงินเข้าแล้วกดยืนยัน
            {round.acceptAfter && <> — ถ้าผู้รับไม่ตอบภายใน {dateTime(round.acceptAfter)} ระบบถือว่าได้รับแล้ว</>}
          </p>
          <p>หากผู้รับแจ้งว่ายังไม่ได้รับเงิน คุณจะแจ้งโอนใหม่ได้ก่อนเวลาผิดนัด</p>
          {mine?.slipVerify === "FAILED" && <p className="text-danger">ระบบตรวจสลิปไม่ผ่าน ผู้รับจะตรวจยอดเงินเข้าเอง</p>}
          {mine?.slipId && (
            <a href={api.slipUrl(mine.slipId)} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
              ดูสลิปที่ส่ง
            </a>
          )}
        </Card>
      )}
      {isSettled(status) && (
        <Card className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-2xl text-success" aria-hidden>
            ✓
          </div>
          <p className="mt-2 font-semibold text-ink">ชำระงวดนี้แล้ว</p>
          <p className="text-sm text-ink-muted">{status === "ATTESTED" ? "ตรวจสลิปกับธนาคารแล้ว ✓" : "บันทึกถาวรแล้ว ✓"}</p>
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

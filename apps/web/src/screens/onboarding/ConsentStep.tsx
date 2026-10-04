import { useState } from "react";
import { Link } from "react-router";
import { TERMS_VERSION, type MeResponse } from "@bankforall/shared";
import { api } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Button } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import { MyData } from "@/components/MyData";

const terms = [
  `${APP_NAME} เป็นผู้ให้บริการซอฟต์แวร์เท่านั้น บริษัทไม่ใช่นายวงแชร์ ไม่ได้เป็นสมาชิกของวงใด และไม่รับหรือถือเงินของสมาชิก`,
  "เงินทุกงวดโอนระหว่างสมาชิกโดยตรงผ่านพร้อมเพย์ ความเสี่ยงจากสมาชิกที่ไม่ชำระเป็นของสมาชิกในวง ระบบช่วยเตือน บันทึกการผิดนัด และออกหลักฐานให้เท่านั้น",
  "วงแชร์ต้องเป็นไปตาม พ.ร.บ.การเล่นแชร์ พ.ศ. 2534 ระบบจำกัดจำนวนสมาชิก มูลค่าทุนต่อวง และจำนวนวงที่เป็นนายวงพร้อมกัน",
  "การกระทำสำคัญ (เข้าวง ประมูล แจ้งโอน ยืนยันรับเงิน) จะถูกลงนามด้วยกุญแจบนเครื่องของคุณและบันทึกถาวร แก้ไขหรือลบภายหลังไม่ได้ ใช้เป็นหลักฐานทางกฎหมายได้",
];

const privacy = [
  "เราเก็บชื่อ LINE เบอร์โทร พร้อมเพย์ รูปบัตรประชาชนและใบหน้า (เพื่อยืนยันตัวตน) และสลิปโอนเงิน",
  "รูปบัตร ใบหน้า และสลิปถูกเข้ารหัสก่อนจัดเก็บ เข้าถึงได้เฉพาะเจ้าหน้าที่ตรวจสอบ และสมาชิกในวงเดียวกัน (เฉพาะสลิป)",
  "ข้อมูลที่บันทึกถาวรมีเพียงรหัสบัญชีแบบสุ่ม จำนวนเงิน และเวลา ไม่มีชื่อหรือเลขบัตรของคุณ",
  "คุณดาวน์โหลดข้อมูลของคุณและขอลบบัญชีได้ในหน้าโปรไฟล์ (PDPA) ยกเว้นข้อมูลที่ต้องเก็บไว้เป็นหลักฐานให้สมาชิกคนอื่น และบันทึกบนเครือข่ายสาธารณะซึ่งลบไม่ได้",
];

export default function ConsentStep({ me, onDone }: { me?: MeResponse; onDone: () => void }) {
  // accepted an older version: the documents changed and must be accepted again
  const updated = Boolean(me?.consentVersion && me.consentVersion !== TERMS_VERSION);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.consent();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {updated && (
        <p className="rounded-2xl bg-warn-soft p-4 text-sm text-ink" role="status">
          ข้อกำหนดการใช้บริการหรือนโยบายความเป็นส่วนตัวมีการปรับปรุง กรุณาอ่านและยอมรับฉบับใหม่ก่อนใช้งานต่อ
        </p>
      )}
      <section className="rounded-2xl bg-white p-4 shadow-xs">
        <h2 className="font-semibold text-ink">ข้อกำหนดการใช้งาน</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-ink-muted">
          {terms.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <Link to="/terms" className="mt-3 inline-block text-sm font-medium text-primary underline">
          อ่านข้อกำหนดการใช้บริการฉบับเต็ม
        </Link>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-xs">
        <h2 className="font-semibold text-ink">นโยบายความเป็นส่วนตัว (PDPA)</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-ink-muted">
          {privacy.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <Link to="/privacy" className="mt-3 inline-block text-sm font-medium text-primary underline">
          อ่านนโยบายความเป็นส่วนตัวฉบับเต็ม
        </Link>
        <p className="mt-3 text-xs text-ink-muted">ฉบับ {TERMS_VERSION}</p>
      </section>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-primary" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
        ฉันเข้าใจว่าบริษัทไม่ใช่นายวงและไม่ถือเงิน และยอมรับข้อกำหนดการใช้งาน
      </label>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-primary" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
        ฉันยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล รวมถึงข้อมูลชีวภาพ (ใบหน้า) เพื่อยืนยันตัวตน
      </label>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button block loading={busy} disabled={!agreeTerms || !agreePrivacy} onClick={() => void submit()}>
        ยอมรับและดำเนินการต่อ
      </Button>
      {updated && me && (
        <details className="text-sm text-ink-muted">
          <summary className="cursor-pointer py-2 text-center">ไม่ต้องการยอมรับฉบับใหม่? ดาวน์โหลดข้อมูลหรือขอลบบัญชี</summary>
          <MyData me={me} />
        </details>
      )}
    </div>
  );
}

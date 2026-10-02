import { useState } from "react";
import { api } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Button, Field } from "@/components/ui";
import { useNow } from "@/components/widgets";

export default function PhoneStep({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const resendIn = sentAt ? Math.max(0, sentAt + 60 - now) : 0;
  const validPhone = /^0\d{9}$/.test(phone);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.sendOtp(phone);
      setDevCode(res.devCode ?? null);
      setSentAt(Math.floor(Date.now() / 1000));
      setCode("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.verifyOtp(code);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!sentAt) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="space-y-5"
      >
        <p className="text-ink-muted">กรอกเบอร์มือถือของคุณ เราจะส่งรหัส 6 หลักทาง SMS เพื่อยืนยัน</p>
        <Field
          label="เบอร์มือถือ"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="0812345678"
          value={phone}
          maxLength={10}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
          error={phone && !validPhone ? "เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0" : error ?? undefined}
        />
        <Button type="submit" block loading={busy} disabled={!validPhone}>
          ส่งรหัสยืนยัน
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-5">
      <p className="text-ink-muted">
        ใส่รหัส 6 หลักที่ส่งไปที่ <strong className="text-ink">{phone}</strong>{" "}
        <button type="button" className="text-primary underline" onClick={() => setSentAt(null)}>
          เปลี่ยนเบอร์
        </button>
      </p>
      <Field
        label="รหัสยืนยัน"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="[&_input]:text-center [&_input]:text-2xl [&_input]:tracking-[0.5em]"
        error={error ?? undefined}
        autoFocus
      />
      {devCode && (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-center text-sm text-amber-800" data-testid="dev-otp">
          รหัสทดสอบ: <strong>{devCode}</strong>
        </p>
      )}
      <Button type="submit" block loading={busy} disabled={code.length !== 6}>
        ยืนยัน
      </Button>
      <p className="text-center text-sm text-ink-muted">
        ไม่ได้รับรหัส?{" "}
        {resendIn > 0 ? (
          <span>ส่งใหม่ได้ใน {resendIn} วินาที</span>
        ) : (
          <button type="button" className="font-medium text-primary underline" onClick={() => void send()} disabled={busy}>
            ส่งรหัสอีกครั้ง
          </button>
        )}
      </p>
    </form>
  );
}

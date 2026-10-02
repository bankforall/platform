import { useState } from "react";
import { parsePromptPayId, type MeResponse } from "@bankforall/shared";
import { api } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Button, Field } from "@/components/ui";

export function validatePromptPay(value: string): string | null {
  try {
    parsePromptPayId(value);
    return null;
  } catch (e) {
    return errorMessage(e);
  }
}

export default function PromptPayStep({ me, onDone }: { me: MeResponse; onDone: () => void }) {
  const [value, setValue] = useState(me.promptPayId ?? me.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = value ? validatePromptPay(value) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setPromptPay(value.replace(/\D/g, ""));
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-ink-muted">
        เมื่อถึงงวดที่คุณได้รับเงินกองกลาง สมาชิกคนอื่นจะโอนเข้าพร้อมเพย์นี้โดยตรง ระบบไม่ได้ถือเงินแทนคุณ
      </p>
      <Field
        label="พร้อมเพย์ (เบอร์มือถือ หรือ เลขประจำตัวประชาชน)"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, ""))}
        error={invalid ?? error ?? undefined}
        hint="ตรวจสอบให้ถูกต้อง — ใช้รับเงินจริง"
      />
      <Button type="submit" block loading={busy} disabled={!value || !!invalid}>
        บันทึก
      </Button>
    </form>
  );
}

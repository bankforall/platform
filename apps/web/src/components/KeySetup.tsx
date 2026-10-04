import { useMemo, useState, type ReactNode } from "react";
import type { WalletBackup } from "@bankforall/shared";
import { errorMessage } from "@/api/client";
import { PinPad, useToast } from "@/components/overlay";
import { Button, Field } from "@/components/ui";
import { encryptBackup, generateRecoveryCode, normalizeRecoveryCode } from "@/wallet/crypto";
import { newPrivateKey, setPin as savePin, storeLocalKey } from "@/wallet/device";

type Sub = "intro" | "pin" | "pin2" | "code" | "verify" | "saving";

export interface CreatedKey {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  /** Private key encrypted with the new recovery code. */
  backup: WalletBackup;
}

/**
 * Creates a new device key: PIN twice → recovery code shown once → check one group → the key is
 * stored on this device with the PIN, then `onCreated` registers it (onboarding, or a key rotation).
 */
export function KeySetup({
  intro,
  submitLabel = "ยืนยันและเปิดใช้งาน",
  onCreated,
}: {
  /** First screen; call `start` to begin. */
  intro: (start: () => void) => ReactNode;
  submitLabel?: string;
  onCreated: (key: CreatedKey) => Promise<void>;
}) {
  const [sub, setSub] = useState<Sub>("intro");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const privateKey = useMemo(() => newPrivateKey(), []);
  const code = useMemo(() => generateRecoveryCode(), []);
  const groups = code.split("-");
  const checkIndex = useMemo(() => Math.floor(Math.random() * groups.length), [groups.length]);
  const toast = useToast();

  const save = async () => {
    setSub("saving");
    setError(null);
    try {
      const address = await storeLocalKey(privateKey);
      await savePin(pin);
      const backup = await encryptBackup(privateKey, code);
      await onCreated({ privateKey, address, backup });
    } catch (e) {
      setError(errorMessage(e));
      setSub("verify");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast("คัดลอกรหัสกู้คืนแล้ว", "success");
    } catch {
      toast("คัดลอกไม่ได้ กรุณาจดด้วยมือ", "error");
    }
  };

  const download = () => {
    const text = `Bank For All — รหัสกู้คืนบัญชี\n\n${code}\n\nเก็บไว้ในที่ปลอดภัย ห้ามส่งให้ผู้อื่น ใช้เมื่อเปลี่ยนหรือทำโทรศัพท์หาย\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "bankforall-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (sub === "intro") return <>{intro(() => setSub("pin"))}</>;

  if (sub === "pin" || sub === "pin2") {
    return (
      <div className="pt-4">
        <h2 className="mb-6 text-center text-xl font-semibold text-ink">{sub === "pin" ? "ตั้ง PIN" : "ยืนยัน PIN อีกครั้ง"}</h2>
        <PinPad
          key={sub}
          label={sub === "pin" ? "ใช้ยืนยันทุกรายการ ห้ามใช้วันเกิด" : "ใส่ PIN เดิมอีกครั้ง"}
          error={pinError}
          onComplete={(p) => {
            if (sub === "pin") {
              if (/^(\d)\1{5}$/.test(p) || "0123456789".includes(p) || "9876543210".includes(p)) {
                setPinError("PIN ง่ายเกินไป กรุณาเลือกใหม่");
                return;
              }
              setPin(p);
              setPinError(null);
              setSub("pin2");
            } else if (p === pin) {
              setPinError(null);
              setSub("code");
            } else {
              setPinError("PIN ไม่ตรงกัน กรุณาตั้งใหม่");
              setSub("pin");
            }
          }}
        />
      </div>
    );
  }

  if (sub === "code") {
    return (
      <div className="space-y-5">
        <h2 className="text-xl font-semibold text-ink">รหัสกู้คืนบัญชี</h2>
        <p className="text-sm text-ink-muted">
          จดหรือบันทึกรหัสนี้ไว้ในที่ปลอดภัย <strong className="text-danger">รหัสนี้จะแสดงครั้งเดียว</strong> และบริษัทไม่มีสำเนา
          หากเปลี่ยนเครื่องโดยไม่มีรหัสนี้ ต้องยืนยันตัวตนใหม่กับเจ้าหน้าที่
        </p>
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white p-4 font-mono text-lg font-semibold tracking-wider text-ink shadow-xs" aria-label="รหัสกู้คืน" data-testid="recovery-code" data-code={code}>
          {groups.map((g, i) => (
            <span key={i} className="rounded-lg bg-surface py-2 text-center">
              <span className="sr-only">ชุดที่ {i + 1}: </span>
              {g}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => void copy()}>
            คัดลอก
          </Button>
          <Button variant="secondary" className="flex-1" onClick={download}>
            ดาวน์โหลด
          </Button>
        </div>
        <Button block onClick={() => setSub("verify")}>
          บันทึกรหัสแล้ว
        </Button>
      </div>
    );
  }

  const correct = normalizeRecoveryCode(typed) === groups[checkIndex];
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (correct) void save();
      }}
    >
      <h2 className="text-xl font-semibold text-ink">ตรวจสอบว่าจดรหัสแล้ว</h2>
      <Field
        label={`พิมพ์รหัสชุดที่ ${checkIndex + 1}`}
        value={typed}
        onChange={(e) => setTyped(e.target.value.toUpperCase())}
        maxLength={4}
        autoCapitalize="characters"
        autoComplete="off"
        className="[&_input]:text-center [&_input]:font-mono [&_input]:text-2xl [&_input]:tracking-[0.4em]"
        error={typed.length === 4 && !correct ? "ไม่ตรงกับรหัสที่แสดง" : error ?? undefined}
        autoFocus
      />
      <Button type="submit" block loading={sub === "saving"} disabled={!correct}>
        {submitLabel}
      </Button>
      <button type="button" className="w-full text-sm text-primary underline" onClick={() => setSub("code")}>
        ดูรหัสอีกครั้ง
      </button>
    </form>
  );
}

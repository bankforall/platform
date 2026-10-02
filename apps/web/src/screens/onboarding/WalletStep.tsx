import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { PinPad, useToast } from "@/components/overlay";
import { Button, Field } from "@/components/ui";
import { encryptBackup, generateRecoveryCode, normalizeRecoveryCode } from "@/wallet/crypto";
import { newPrivateKey, setPin as savePin, storeLocalKey } from "@/wallet/device";

type Sub = "intro" | "pin" | "pin2" | "code" | "verify" | "saving";

export default function WalletStep({ onDone }: { onDone: () => void }) {
  const [sub, setSub] = useState<Sub>("intro");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const privateKey = useMemo(() => newPrivateKey(), []);
  const code = useMemo(() => generateRecoveryCode(), []);
  const groups = code.split("-");
  const checkIndex = useMemo(() => Math.floor(Math.random() * groups.length), [groups.length]);
  const queryClient = useQueryClient();
  const toast = useToast();

  const save = async () => {
    setSub("saving");
    setError(null);
    try {
      const address = await storeLocalKey(privateKey);
      await savePin(pin);
      const backup = await encryptBackup(privateKey, code);
      await api.registerWallet(address, backup);
      await queryClient.invalidateQueries({ queryKey: ["localAddress"] });
      onDone();
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

  if (sub === "intro") {
    return (
      <div className="space-y-5">
        <div className="text-center text-6xl" aria-hidden>
          🔐
        </div>
        <h2 className="text-center text-xl font-semibold text-ink">ลายเซ็นดิจิทัลของคุณ</h2>
        <p className="text-ink-muted">
          ทุกการกระทำในวงแชร์ (เข้าวง ประมูล แจ้งโอน ยืนยันรับเงิน) จะถูกลงนามด้วยกุญแจที่สร้างและเก็บไว้บนเครื่องนี้เท่านั้น
          บริษัทไม่สามารถทำรายการแทนคุณได้ — หลักฐานจึงมีน้ำหนัก
        </p>
        <ul className="space-y-2 rounded-2xl bg-white p-4 text-sm text-ink shadow-sm">
          <li>1. ตั้ง PIN 6 หลักสำหรับยืนยันทุกรายการ</li>
          <li>2. จดรหัสกู้คืนบัญชี ใช้เมื่อเปลี่ยนหรือทำโทรศัพท์หาย</li>
        </ul>
        <Button block onClick={() => setSub("pin")}>
          เริ่มตั้งค่า
        </Button>
      </div>
    );
  }

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
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white p-4 font-mono text-lg font-semibold tracking-wider text-ink shadow-sm" aria-label="รหัสกู้คืน" data-testid="recovery-code" data-code={code}>
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
        ยืนยันและเปิดใช้งาน
      </Button>
      <button type="button" className="w-full text-sm text-primary underline" onClick={() => setSub("code")}>
        ดูรหัสอีกครั้ง
      </button>
    </form>
  );
}

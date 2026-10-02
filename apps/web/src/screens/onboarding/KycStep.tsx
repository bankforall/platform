import { useEffect, useState } from "react";
import type { MeResponse } from "@bankforall/shared";
import { api } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Button, Field } from "@/components/ui";

const MAX_BYTES = 8 * 1024 * 1024;

/** Thai national ID checksum (mod 11). */
export function isValidThaiId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const digits = id.split("").map(Number);
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === digits[12];
}

function PhotoInput({
  label,
  hint,
  capture,
  file,
  onChange,
}: {
  label: string;
  hint: string;
  capture: "user" | "environment";
  file: File | null;
  onChange: (f: File | null, error?: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-primary/40 bg-white p-4 text-center focus-within:ring-2 focus-within:ring-primary">
      <span className="block font-medium text-ink">{label}</span>
      <span className="block text-xs text-ink-muted">{hint}</span>
      {preview ? (
        <img src={preview} alt={`ตัวอย่าง${label}`} className="mx-auto mt-3 max-h-40 rounded-xl object-contain" />
      ) : (
        <span className="mt-3 block text-4xl" aria-hidden>
          📷
        </span>
      )}
      <span className="mt-2 inline-block text-sm font-medium text-primary">{file ? "ถ่ายใหม่" : "ถ่ายรูป / เลือกรูป"}</span>
      <input
        type="file"
        accept="image/*"
        capture={capture}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f && f.size > MAX_BYTES) onChange(null, "ไฟล์ใหญ่เกิน 8MB");
          else if (f && !f.type.startsWith("image/")) onChange(null, "ต้องเป็นไฟล์รูปภาพ");
          else onChange(f);
        }}
      />
    </label>
  );
}

export default function KycStep({ me, onDone }: { me: MeResponse; onDone: () => void }) {
  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [idCard, setIdCard] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idInvalid = nationalId.length === 13 && !isValidThaiId(nationalId);
  const ready = fullName.trim().length >= 3 && isValidThaiId(nationalId) && idCard && selfie;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("fullName", fullName.trim());
      form.append("nationalId", nationalId);
      form.append("idCard", idCard);
      form.append("selfie", selfie);
      await api.submitKyc(form);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {me.kycStatus === "REJECTED" && (
        <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">
          การยืนยันตัวตนครั้งก่อนไม่ผ่าน{me.kycReason ? `: ${me.kycReason}` : ""} กรุณาส่งใหม่
        </p>
      )}
      <p className="text-sm text-ink-muted">
        กฎหมายกำหนดให้นายวงและสมาชิกเป็นบุคคลที่ยืนยันตัวตนได้ ข้อมูลถูกเข้ารหัสและใช้เพื่อการตรวจสอบเท่านั้น
      </p>
      <Field label="ชื่อ-นามสกุล (ตามบัตรประชาชน)" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
      <Field
        label="เลขประจำตัวประชาชน 13 หลัก"
        inputMode="numeric"
        maxLength={13}
        value={nationalId}
        onChange={(e) => setNationalId(e.target.value.replace(/\D/g, ""))}
        error={idInvalid ? "เลขประจำตัวประชาชนไม่ถูกต้อง" : undefined}
      />
      <PhotoInput
        label="รูปบัตรประชาชน (ด้านหน้า)"
        hint="ถ่ายให้เห็นตัวอักษรชัดเจน ไม่มีแสงสะท้อน"
        capture="environment"
        file={idCard}
        onChange={(f, err) => {
          setIdCard(f);
          setError(err ?? null);
        }}
      />
      <PhotoInput
        label="รูปถ่ายใบหน้าคู่กับบัตร"
        hint="ถือบัตรไว้ข้างใบหน้า มองกล้องตรงๆ"
        capture="user"
        file={selfie}
        onChange={(f, err) => {
          setSelfie(f);
          setError(err ?? null);
        }}
      />
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" block loading={busy} disabled={!ready}>
        ส่งข้อมูลยืนยันตัวตน
      </Button>
    </form>
  );
}

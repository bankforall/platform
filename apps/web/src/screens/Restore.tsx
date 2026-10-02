import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { privateKeyToAccount } from "viem/accounts";
import { api } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useMe } from "@/hooks/session";
import { Header, Screen } from "@/components/layout";
import { PinPad } from "@/components/overlay";
import { Button, Field, Loading } from "@/components/ui";
import { decryptBackup, isValidRecoveryCode, formatRecoveryCode } from "@/wallet/crypto";
import { setPin, storeLocalKey } from "@/wallet/device";
import { sameAddress } from "@/lib/format";

export default function Restore() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [key, setKey] = useState<`0x${string}` | null>(null);
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/welcome" replace />;
  if (!me.data.walletAddress) return <Navigate to="/onboarding" replace />;
  const expected = me.data.walletAddress;

  const decrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const backup = await api.walletBackup();
      const pk = await decryptBackup(backup, code);
      if (!sameAddress(privateKeyToAccount(pk).address, expected)) throw new Error("รหัสกู้คืนนี้ไม่ใช่ของบัญชีนี้");
      setKey(pk);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (pin: string) => {
    if (!key) return;
    if (!firstPin) {
      setFirstPin(pin);
      setError(null);
      return;
    }
    if (pin !== firstPin) {
      setFirstPin(null);
      setError("PIN ไม่ตรงกัน กรุณาตั้งใหม่");
      return;
    }
    await storeLocalKey(key);
    await setPin(pin);
    await queryClient.invalidateQueries({ queryKey: ["localAddress"] });
    navigate("/", { replace: true });
  };

  return (
    <Screen nav={false}>
      <Header title="กู้คืนบัญชีบนเครื่องนี้" />
      <main className="px-5 py-6">
        {!key ? (
          <form onSubmit={decrypt} className="space-y-5">
            <p className="text-ink-muted">
              บัญชีของคุณใช้งานอยู่บนเครื่องอื่น ใส่รหัสกู้คืน 24 ตัวอักษรที่คุณจดไว้ตอนสมัคร เพื่อใช้งานบนเครื่องนี้
            </p>
            <Field
              label="รหัสกู้คืน"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onBlur={() => isValidRecoveryCode(code) && setCode(formatRecoveryCode(code))}
              placeholder="ABCD-EFGH-IJKL-MNOP-QRST-UVWX"
              autoCapitalize="characters"
              autoComplete="off"
              className="[&_input]:font-mono"
              error={error ?? undefined}
            />
            <Button type="submit" block loading={busy} disabled={!isValidRecoveryCode(code)}>
              กู้คืน
            </Button>
            <details className="rounded-2xl bg-white p-4 text-sm text-ink-muted shadow-sm">
              <summary className="cursor-pointer font-medium text-ink">ทำรหัสกู้คืนหาย?</summary>
              <p className="mt-2">
                ติดต่อเจ้าหน้าที่ผ่าน LINE Official เพื่อยืนยันตัวตนอีกครั้ง เจ้าหน้าที่จะออกกุญแจใหม่ให้และย้ายสมาชิกภาพในทุกวงไปยังกุญแจใหม่
                ประวัติเดิมทั้งหมดยังคงอยู่
              </p>
            </details>
          </form>
        ) : (
          <div className="pt-2">
            <p className="mb-6 rounded-xl bg-success-soft p-3 text-center text-sm text-success">กู้คืนกุญแจสำเร็จ ตั้ง PIN สำหรับเครื่องนี้</p>
            <PinPad key={firstPin ? "2" : "1"} label={firstPin ? "ใส่ PIN อีกครั้ง" : "ตั้ง PIN 6 หลัก"} error={error} onComplete={(p) => void finish(p)} />
          </div>
        )}
      </main>
    </Screen>
  );
}

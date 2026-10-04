import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { privateKeyToAccount } from "viem/accounts";
import { keyRotationMessage, walletProofMessage, type MeResponse } from "@bankforall/shared";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useLocalAddress, useMe } from "@/hooks/session";
import { Header, Screen } from "@/components/layout";
import { KeySetup } from "@/components/KeySetup";
import { KeyRotationNotice } from "@/components/KeyRotationNotice";
import { PinPad, useToast } from "@/components/overlay";
import { Button, Card, Field, KeyValue, Loading } from "@/components/ui";
import { decryptBackup, isValidRecoveryCode, formatRecoveryCode } from "@/wallet/crypto";
import { clearPendingBackup, savePendingBackup, setPin, storeLocalKey } from "@/wallet/device";
import { dateTime, sameAddress } from "@/lib/format";

type Rotation = NonNullable<MeResponse["pendingKeyRotation"]>;

/** Status of a key rotation requested from this device. */
function RotationStatus({ rotation }: { rotation: Rotation }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // Poll: admins approve and the switch happens without any action on this device.
  useEffect(() => {
    const t = setInterval(() => void queryClient.invalidateQueries({ queryKey: qk.me }), 30_000);
    return () => clearInterval(t);
  }, [queryClient]);

  const cancel = async () => {
    if (!window.confirm("ยกเลิกคำขอเปลี่ยนกุญแจ?")) return;
    setBusy(true);
    try {
      await api.cancelKeyRotation();
      await clearPendingBackup();
      await queryClient.invalidateQueries({ queryKey: qk.me });
      toast("ยกเลิกคำขอแล้ว", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const approved = rotation.approvals >= 2;
  return (
    <div className="space-y-5">
      <div className="text-center text-6xl" aria-hidden>
        ⏳
      </div>
      <h2 className="text-center text-xl font-semibold text-ink">ส่งคำขอเปลี่ยนกุญแจแล้ว</h2>
      <Card className="space-y-1">
        <KeyValue label="ผู้ดูแลอนุมัติแล้ว">{Math.min(rotation.approvals, 2)}/2</KeyValue>
        <KeyValue label="ส่งคำขอเมื่อ">{new Date(rotation.createdAt).toLocaleString("th-TH")}</KeyValue>
        {rotation.executeAfter && <KeyValue label="จะเปลี่ยนได้หลัง">{dateTime(rotation.executeAfter)}</KeyValue>}
      </Card>
      <p className="text-sm text-ink-muted">
        {approved
          ? `อนุมัติครบแล้ว ระบบจะเปลี่ยนไปใช้กุญแจบนเครื่องนี้หลัง ${dateTime(rotation.executeAfter)} ระหว่างนี้ยังยกเลิกได้`
          : "เจ้าหน้าที่จะติดต่อเพื่อยืนยันตัวตนอีกครั้ง ต้องมีผู้ดูแล 2 คนอนุมัติ แล้วรออีก 24 ชั่วโมงก่อนเปลี่ยนกุญแจ"}
      </p>
      <p className="text-sm text-ink-muted">เมื่อเปลี่ยนแล้ว สมาชิกภาพและประวัติในทุกวงจะย้ายมาที่เครื่องนี้ หน้านี้จะไปต่อให้อัตโนมัติ</p>
      <Button block variant="ghost" className="text-danger" loading={busy} onClick={() => void cancel()}>
        ยกเลิกคำขอ
      </Button>
    </div>
  );
}

/** Lost device and recovery code: create a new key here and ask to move the account to it. */
function ForgotFlow({ me, onBack }: { me: MeResponse; onBack: () => void }) {
  const queryClient = useQueryClient();
  const kycOk = me.kycStatus === "APPROVED";
  return (
    <KeySetup
      submitLabel="ยืนยันและส่งคำขอ"
      intro={(start) => (
        <div className="space-y-5">
          <h2 className="text-xl font-semibold text-ink">ลืมรหัสกู้คืนหรือทำเครื่องหาย</h2>
          <p className="text-ink-muted">
            สร้างกุญแจใหม่บนเครื่องนี้ แล้วขอย้ายบัญชีมาใช้กุญแจใหม่ สมาชิกภาพและประวัติในทุกวงยังอยู่ครบ
          </p>
          <ul className="space-y-2 rounded-2xl bg-white p-4 text-sm text-ink shadow-xs">
            <li>1. ตั้ง PIN และจดรหัสกู้คืนชุดใหม่สำหรับเครื่องนี้</li>
            <li>2. เจ้าหน้าที่ยืนยันตัวตนคุณอีกครั้ง ต้องมีผู้ดูแล 2 คนอนุมัติ</li>
            <li>3. หลังอนุมัติครบ รออีก 24 ชั่วโมงจึงเปลี่ยนกุญแจ (ยกเลิกได้ระหว่างนี้)</li>
          </ul>
          {!kycOk && (
            <p className="rounded-xl bg-warn-soft p-3 text-sm text-amber-800" role="alert">
              ต้องยืนยันตัวตน (KYC) ผ่านแล้วเท่านั้นจึงขอเปลี่ยนกุญแจได้ กรุณาติดต่อเจ้าหน้าที่
            </p>
          )}
          <Button block disabled={!kycOk} onClick={start}>
            เริ่มสร้างกุญแจใหม่
          </Button>
          <Button block variant="ghost" onClick={onBack}>
            กลับไปใช้รหัสกู้คืน
          </Button>
        </div>
      )}
      onCreated={async ({ privateKey, address, backup }) => {
        const account = privateKeyToAccount(privateKey);
        const rotationProof = await account.signMessage({ message: keyRotationMessage(me.id, address) });
        const walletProof = await account.signMessage({ message: walletProofMessage(me.id, address) });
        await savePendingBackup({ address, proof: walletProof, backup });
        const updated = await api.requestKeyRotation(address, rotationProof);
        queryClient.setQueryData(qk.me, updated);
        await queryClient.invalidateQueries({ queryKey: ["localAddress"] });
        await queryClient.invalidateQueries({ queryKey: ["pendingBackup"] });
      }}
    />
  );
}

export default function Restore() {
  const me = useMe();
  const local = useLocalAddress();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [forgot, setForgot] = useState(false);
  const [code, setCode] = useState("");
  const [key, setKey] = useState<`0x${string}` | null>(null);
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.isLoading || local.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/welcome" replace />;
  if (!me.data.walletAddress) return <Navigate to="/onboarding" replace />;
  // Restored, or a key rotation requested from this device has executed: the app takes over.
  if (!key && sameAddress(me.data.walletAddress, local.data)) return <Navigate to="/" replace />;
  const expected = me.data.walletAddress;
  const rotation = me.data.pendingKeyRotation;

  if (!key && rotation && sameAddress(rotation.newAddress, local.data)) {
    return (
      <Screen nav={false}>
        <Header title="เปลี่ยนกุญแจบัญชี" />
        <main className="px-5 py-6">
          <RotationStatus rotation={rotation} />
        </main>
      </Screen>
    );
  }
  if (!key && forgot) {
    return (
      <Screen nav={false}>
        <Header title="เปลี่ยนกุญแจบัญชี" />
        <main className="px-5 py-6">
          <ForgotFlow me={me.data} onBack={() => setForgot(false)} />
        </main>
      </Screen>
    );
  }

  const decrypt = async (e: React.SubmitEvent<HTMLFormElement>) => {
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
    await clearPendingBackup();
    await queryClient.invalidateQueries({ queryKey: ["localAddress"] });
    await queryClient.invalidateQueries({ queryKey: ["pendingBackup"] });
    navigate("/", { replace: true });
  };

  return (
    <Screen nav={false}>
      <Header title="กู้คืนบัญชีบนเครื่องนี้" />
      <main className="px-5 py-6">
        {!key ? (
          <form onSubmit={decrypt} className="space-y-5">
            <KeyRotationNotice />
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
            <div className="rounded-2xl bg-white p-4 text-sm text-ink-muted shadow-xs">
              <p className="font-medium text-ink">ลืมรหัสกู้คืนหรือทำเครื่องหาย</p>
              <p className="mt-1">
                สร้างกุญแจใหม่บนเครื่องนี้แล้วขอย้ายบัญชี ต้องมีผู้ดูแล 2 คนอนุมัติและรอ 24 ชั่วโมง สมาชิกภาพและประวัติในทุกวงยังอยู่ครบ
              </p>
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setForgot(true)}>
                ลืมรหัสกู้คืนหรือทำเครื่องหาย
              </Button>
            </div>
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

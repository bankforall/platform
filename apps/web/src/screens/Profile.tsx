import { SOURCE_URL } from "@/lib/source";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { ApiError, errorMessage } from "@/api/client";
import { useMe } from "@/hooks/session";
import { Header, Screen } from "@/components/layout";
import { KeyRotationNotice } from "@/components/KeyRotationNotice";
import { useToast } from "@/components/overlay";
import { Avatar, Button, Card, Chip, Field, KeyValue, SectionTitle } from "@/components/ui";
import { shortAddress } from "@/lib/format";
import { clearDevice } from "@/wallet/device";
import { validatePromptPay } from "./onboarding/PromptPayStep";

const kycText = { NONE: "ยังไม่ยืนยัน", PENDING: "รอตรวจสอบ", APPROVED: "ยืนยันแล้ว", REJECTED: "ไม่ผ่าน" } as const;

export default function Profile() {
  const me = useMe().data!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [pp, setPp] = useState(me.promptPayId ?? "");
  const [busy, setBusy] = useState(false);
  // Changing an existing PromptPay ID needs a fresh OTP to the verified phone.
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [ppError, setPpError] = useState<string | null>(null);
  const needsStepUp = !!me.promptPayId;

  const closeEditor = () => {
    setEditing(false);
    setOtpSent(false);
    setOtp("");
    setDevCode(null);
    setPpError(null);
    setPp(me.promptPayId ?? "");
  };

  const ppMessage = (e: unknown) =>
    e instanceof ApiError && e.code === "RECIPIENT_LOCKED"
      ? "เปลี่ยนไม่ได้ระหว่างที่คุณเป็นผู้รับเงินของรอบที่ยังไม่ปิด"
      : errorMessage(e);

  const sendStepUp = async () => {
    setBusy(true);
    setPpError(null);
    try {
      const res = await api.stepUpOtp();
      setDevCode(res.devCode ?? null);
      setOtpSent(true);
    } catch (e) {
      setPpError(ppMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const savePromptPay = async () => {
    setBusy(true);
    setPpError(null);
    try {
      await api.setPromptPay(pp.replace(/\D/g, ""), needsStepUp ? otp : undefined);
      await queryClient.invalidateQueries({ queryKey: qk.me });
      closeEditor();
      toast("บันทึกพร้อมเพย์แล้ว", "success");
    } catch (e) {
      setPpError(ppMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async (wipe: boolean) => {
    if (wipe && !window.confirm("ลบกุญแจออกจากเครื่องนี้? ต้องใช้รหัสกู้คืนเพื่อใช้งานอีกครั้ง")) return;
    try {
      await api.logout();
    } catch {
      /* already logged out */
    }
    if (wipe) await clearDevice();
    queryClient.clear();
    navigate("/welcome", { replace: true });
  };

  return (
    <Screen>
      <Header title="โปรไฟล์" />
      <main className="px-4 py-4">
        <KeyRotationNotice />
        <Card className="flex items-center gap-4">
          <Avatar name={me.displayName} src={me.pictureUrl} size={64} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink">{me.displayName}</p>
            <p className="text-sm text-ink-muted">{me.phone ?? "–"}</p>
            <Chip tone={me.kycStatus === "APPROVED" ? "success" : me.kycStatus === "REJECTED" ? "danger" : "warn"}>{kycText[me.kycStatus]}</Chip>
          </div>
        </Card>

        <SectionTitle>คะแนนความน่าเชื่อถือ</SectionTitle>
        <Card>
          <p className="text-4xl font-semibold text-primary">{me.reputation}</p>
          <p className="mt-1 text-sm text-ink-muted">
            คำนวณจากประวัติการจ่ายในทุกวง จ่ายตรงเวลาเพิ่มคะแนน ผิดนัดลดคะแนน นายวงใช้กำหนดคุณสมบัติสมาชิก และใช้ตัดสินเมื่อประมูลเสนอเท่ากัน
          </p>
        </Card>

        <SectionTitle>บัญชีรับเงิน</SectionTitle>
        <Card>
          {editing ? (
            <div className="space-y-3">
              <Field
                label="พร้อมเพย์"
                value={pp}
                onChange={(e) => setPp(e.target.value)}
                inputMode="numeric"
                disabled={otpSent}
                error={pp ? validatePromptPay(pp) ?? undefined : undefined}
              />
              {needsStepUp && !otpSent && (
                <p className="text-xs text-ink-muted">เพื่อความปลอดภัย ระบบจะส่งรหัสยืนยันไปที่เบอร์ {me.phone ?? "ที่ยืนยันไว้"} ก่อนเปลี่ยนบัญชีรับเงิน</p>
              )}
              {otpSent && (
                <>
                  <Field
                    label="รหัสยืนยันทาง SMS"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    hint={`ส่งไปที่ ${me.phone ?? "เบอร์ที่ยืนยันไว้"}`}
                  />
                  {devCode && (
                    <p className="rounded-xl bg-warn-soft px-3 py-2 text-center text-sm text-amber-800" data-testid="dev-otp">
                      รหัสทดสอบ: <strong>{devCode}</strong>
                    </p>
                  )}
                </>
              )}
              {ppError && (
                <p className="text-sm text-danger" role="alert">
                  {ppError}
                </p>
              )}
              <div className="flex gap-2">
                {needsStepUp && !otpSent ? (
                  <Button className="flex-1" loading={busy} disabled={!!validatePromptPay(pp)} onClick={() => void sendStepUp()}>
                    ส่งรหัสยืนยัน
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    loading={busy}
                    disabled={!!validatePromptPay(pp) || (needsStepUp && otp.length !== 6)}
                    onClick={() => void savePromptPay()}
                  >
                    บันทึก
                  </Button>
                )}
                <Button className="flex-1" variant="ghost" onClick={closeEditor}>
                  ยกเลิก
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <KeyValue label="พร้อมเพย์">{me.promptPayId ?? "–"}</KeyValue>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                แก้ไข
              </Button>
            </div>
          )}
        </Card>

        <SectionTitle>ความปลอดภัย</SectionTitle>
        <Card className="space-y-2 text-sm">
          <KeyValue label="รหัสบัญชีสำหรับลงนาม">{shortAddress(me.walletAddress)}</KeyValue>
          <p className="text-ink-muted">
            กุญแจลงนามเก็บอยู่บนเครื่องนี้เท่านั้น หากเปลี่ยนเครื่องให้ใช้รหัสกู้คืนที่จดไว้ หากลืมรหัสกู้คืนหรือทำเครื่องหาย
            ให้เข้าสู่ระบบบนเครื่องใหม่แล้วเลือก “ลืมรหัสกู้คืนหรือทำเครื่องหาย” (ต้องมีผู้ดูแล 2 คนอนุมัติและรอ 24 ชั่วโมง)
          </p>
        </Card>

        {me.role === "ADMIN" && (
          <Link to="/admin" className="mt-4 block rounded-2xl bg-ink p-4 text-center font-semibold text-white">
            ระบบหลังบ้าน (ตรวจสอบตัวตน · คำขอเปลี่ยนกุญแจ)
          </Link>
        )}

        <div className="mt-6 space-y-2">
          <Button block variant="secondary" onClick={() => void logout(false)}>
            ออกจากระบบ
          </Button>
          <Button block variant="ghost" className="text-danger" onClick={() => void logout(true)}>
            ออกจากระบบและลบกุญแจจากเครื่องนี้
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          ซอฟต์แวร์โอเพนซอร์ส (AGPL-3.0) ·{" "}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="underline">
            ดูซอร์สโค้ด
          </a>
        </p>
      </main>
    </Screen>
  );
}

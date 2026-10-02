import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useMe } from "@/hooks/session";
import { Header, Screen } from "@/components/layout";
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

  const savePromptPay = async () => {
    setBusy(true);
    try {
      await api.setPromptPay(pp.replace(/\D/g, ""));
      await queryClient.invalidateQueries({ queryKey: qk.me });
      setEditing(false);
      toast("บันทึกพร้อมเพย์แล้ว", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
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
              <Field label="พร้อมเพย์" value={pp} onChange={(e) => setPp(e.target.value)} inputMode="numeric" error={pp ? validatePromptPay(pp) ?? undefined : undefined} />
              <div className="flex gap-2">
                <Button className="flex-1" loading={busy} disabled={!!validatePromptPay(pp)} onClick={() => void savePromptPay()}>
                  บันทึก
                </Button>
                <Button className="flex-1" variant="ghost" onClick={() => setEditing(false)}>
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
            กุญแจลงนามเก็บอยู่บนเครื่องนี้เท่านั้น หากเปลี่ยนเครื่องให้ใช้รหัสกู้คืนที่จดไว้ หากทำหายให้ติดต่อเจ้าหน้าที่เพื่อยืนยันตัวตนใหม่
          </p>
        </Card>

        {me.role === "ADMIN" && (
          <Link to="/admin" className="mt-4 block rounded-2xl bg-ink p-4 text-center font-semibold text-white">
            ระบบหลังบ้าน (ตรวจสอบตัวตน)
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
      </main>
    </Screen>
  );
}

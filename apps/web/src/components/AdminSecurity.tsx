import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminSecurityView } from "@bankforall/shared";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useToast } from "@/components/overlay";
import { Button, Card, Chip, ErrorState, Field, Loading } from "@/components/ui";
import { useAdminStepUp } from "@/hooks/adminStepUp";
import { confirmAdminPasskey, enrolPasskey, passkeyErrorMessage, passkeysSupported } from "@/lib/passkey";

const time = (iso: string) => new Date(iso).toLocaleString("th-TH");

/** "ความปลอดภัยผู้ดูแล": enrol, list and remove the admin's passkeys (second factor on top of LINE login). */
export function AdminSecurity({ query }: { query: { data?: AdminSecurityView; isLoading: boolean; error: unknown; refetch: () => unknown } }) {
  const toast = useToast();
  const guard = useAdminStepUp();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const view = query.data;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.adminSecurity });
    // lists refused with ADMIN_PASSKEY_REQUIRED can load now
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  };

  const add = async () => {
    const label = name.trim() || "พาสคีย์ของฉัน";
    setBusy("add");
    try {
      await guard(() => enrolPasskey(label));
      setName("");
      toast("เพิ่มพาสคีย์แล้ว", "success");
      refresh();
    } catch (e) {
      toast(passkeyErrorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const verifyNow = async () => {
    setBusy("verify");
    try {
      await confirmAdminPasskey();
      toast("ยืนยันตัวตนแล้ว", "success");
      refresh();
    } catch (e) {
      toast(passkeyErrorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, label: string) => {
    if (!window.confirm(`ลบพาสคีย์ "${label}"? อุปกรณ์นั้นจะใช้ยืนยันตัวตนผู้ดูแลไม่ได้อีก`)) return;
    setBusy(id);
    try {
      await guard(() => api.deletePasskey(id));
      toast("ลบพาสคีย์แล้ว", "success");
      refresh();
    } catch (e) {
      toast(passkeyErrorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="admin-security" className="space-y-3 pt-4">
      <h2 id="admin-security" className="text-lg font-semibold text-ink">
        ความปลอดภัยผู้ดูแล
      </h2>
      {query.isLoading ? (
        <Loading />
      ) : !view ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <Card className="space-y-3 text-sm">
          <p className="text-ink-muted">
            นอกจากเข้าสู่ระบบด้วย LINE ผู้ดูแลต้องยืนยันด้วยพาสคีย์ (สแกนนิ้ว ใบหน้า หรือกุญแจความปลอดภัย)
            ก่อนอนุมัติหรือเปลี่ยนแปลงข้อมูลใด ๆ ถ้ามีคนเข้าบัญชี LINE ของคุณได้ ก็ยังทำรายการแทนคุณไม่ได้
          </p>
          {view.passkeys.length === 0 ? (
            <p className="font-medium text-danger">
              {view.required
                ? "ยังไม่มีพาสคีย์ — ต้องลงทะเบียนก่อนจึงจะใช้เมนูผู้ดูแลได้"
                : "ยังไม่มีพาสคีย์ (ระบบทดสอบไม่บังคับ แต่ควรลงทะเบียน)"}
            </p>
          ) : view.stepUpExpiresAt ? (
            <p>
              <Chip tone="success">ยืนยันแล้ว</Chip> ทำรายการได้ถึง {time(view.stepUpExpiresAt)}
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-ink-muted">ระบบจะขอพาสคีย์อีกครั้งเมื่อคุณอนุมัติหรือเปลี่ยนแปลงรายการ</p>
              <Button size="sm" variant="secondary" loading={busy === "verify"} onClick={() => void verifyNow()}>
                ยืนยันตอนนี้
              </Button>
            </div>
          )}

          {view.passkeys.length > 0 && (
            <ul className="divide-y divide-gray-100" aria-label="พาสคีย์ของคุณ">
              {view.passkeys.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">🔑 {p.name}</p>
                    <p className="text-xs text-ink-muted">
                      เพิ่มเมื่อ {time(p.createdAt)}
                      {p.lastUsedAt ? ` · ใช้ล่าสุด ${time(p.lastUsedAt)}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === p.id}
                    disabled={view.required && view.passkeys.length === 1}
                    title={view.required && view.passkeys.length === 1 ? "ลบพาสคีย์สุดท้ายไม่ได้ เพิ่มพาสคีย์อื่นก่อน" : undefined}
                    aria-label={`ลบพาสคีย์ ${p.name}`}
                    onClick={() => void remove(p.id, p.name)}
                  >
                    ลบ
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {!passkeysSupported() ? (
            <p className="text-ink-muted">เบราว์เซอร์นี้ไม่รองรับพาสคีย์ — ใช้ Chrome, Safari หรือ Edge รุ่นใหม่</p>
          ) : view.enrolment === "relogin" ? (
            <p className="text-ink-muted">
              การลงทะเบียนพาสคีย์แรกต้องทำภายใน 15 นาทีหลังเข้าสู่ระบบ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่
              ถ้าทำอุปกรณ์หายทั้งหมด ให้ติดต่อทีมดูแลระบบเพื่อล้างพาสคีย์
            </p>
          ) : (
            <div className="space-y-2">
              <Field
                label="ชื่ออุปกรณ์สำหรับพาสคีย์ใหม่"
                placeholder="เช่น มือถือของฉัน"
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                hint={view.passkeys.length ? "ควรมีอย่างน้อย 2 อุปกรณ์ เผื่อเครื่องหาย" : undefined}
              />
              <Button block variant="secondary" loading={busy === "add"} onClick={() => void add()}>
                เพิ่มพาสคีย์
              </Button>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}

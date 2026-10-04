import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ADMIN_ERROR } from "@bankforall/shared";
import { ApiError } from "@/api/client";
import { qk } from "@/api/endpoints";
import { BottomSheet } from "@/components/overlay";
import { Button } from "@/components/ui";
import { confirmAdminPasskey, passkeyErrorMessage } from "@/lib/passkey";

/** Runs an admin change; if the API answers ADMIN_STEP_UP_REQUIRED, asks for the passkey and retries once. */
type Guard = <T>(action: () => Promise<T>) => Promise<T>;

const GuardContext = createContext<Guard>((action) => action());

export const useAdminStepUp = () => useContext(GuardContext);

export const isStepUpRequired = (e: unknown) => e instanceof ApiError && e.code === ADMIN_ERROR.stepUpRequired;

export function AdminStepUpProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // every action waiting for the same prompt (e.g. two clicks) continues after one confirmation
  const waiting = useRef<{ resolve: () => void; reject: (e: unknown) => void }[]>([]);

  const guard = useCallback<Guard>(async (action) => {
    try {
      return await action();
    } catch (e) {
      if (!isStepUpRequired(e)) throw e;
      setError(null);
      setOpen(true);
      // the passkey prompt starts from the button below: browsers want a fresh tap for WebAuthn
      await new Promise<void>((resolve, reject) => waiting.current.push({ resolve, reject }));
      return action();
    }
  }, []);

  const settle = (ok: boolean) => {
    const list = waiting.current;
    waiting.current = [];
    setOpen(false);
    for (const w of list) {
      if (ok) w.resolve();
      else w.reject(new ApiError(403, ADMIN_ERROR.stepUpRequired, "ยกเลิกแล้ว — ต้องยืนยันด้วยพาสคีย์ก่อนทำรายการนี้"));
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmAdminPasskey();
      void queryClient.invalidateQueries({ queryKey: qk.adminSecurity });
      settle(true);
    } catch (e) {
      setError(passkeyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GuardContext.Provider value={guard}>
      {children}
      <BottomSheet open={open} onClose={() => settle(false)} title="ยืนยันตัวตนผู้ดูแล">
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            รายการนี้เปลี่ยนแปลงข้อมูลในระบบ ต้องยืนยันด้วยพาสคีย์ของคุณ (สแกนนิ้ว ใบหน้า หรือรหัสเครื่อง) ก่อน
            การยืนยันมีผลช่วงเวลาสั้น ๆ สำหรับรายการถัดไปด้วย
          </p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button block loading={busy} onClick={() => void confirm()}>
            ยืนยันด้วยพาสคีย์
          </Button>
        </div>
      </BottomSheet>
    </GuardContext.Provider>
  );
}

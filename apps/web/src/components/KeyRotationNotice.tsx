import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useLocalAddress, useMe } from "@/hooks/session";
import { dateTime, sameAddress } from "@/lib/format";
import { clearPendingBackup } from "@/wallet/device";
import { useToast } from "./overlay";
import { Button } from "./ui";

/**
 * Warns about a key rotation requested for this account from another device. If it was not the
 * user, cancelling it here (before the 24-hour delay ends) keeps the account on the current key.
 */
export function KeyRotationNotice() {
  const me = useMe().data;
  const local = useLocalAddress().data;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const rotation = me?.pendingKeyRotation;
  if (!rotation || sameAddress(rotation.newAddress, local)) return null;

  const cancel = async () => {
    if (!window.confirm("ยกเลิกคำขอเปลี่ยนกุญแจของบัญชีนี้?")) return;
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

  return (
    <div className="mb-3 rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">
      <p className="font-semibold">มีคำขอย้ายบัญชีนี้ไปใช้กุญแจบนเครื่องอื่น</p>
      <p className="mt-1">
        อนุมัติแล้ว {Math.min(rotation.approvals, 2)}/2
        {rotation.executeAfter ? ` · จะเปลี่ยนหลัง ${dateTime(rotation.executeAfter)}` : ""} ถ้าไม่ใช่คุณ กดยกเลิกทันที
      </p>
      <Button size="sm" variant="danger" className="mt-2" loading={busy} onClick={() => void cancel()}>
        ยกเลิกคำขอ
      </Button>
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { MeResponse } from "@bankforall/shared";
import { api, qk } from "@/api/endpoints";
import { ApiError, errorMessage } from "@/api/client";
import { BottomSheet, useToast } from "@/components/overlay";
import { Button, Card } from "@/components/ui";
import { downloadFile } from "@/lib/download";

const when = (iso: string) => new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

/**
 * PDPA rights in the app: download my data, request (or cancel) account deletion, read the
 * terms and privacy policy. Used on the profile screen and when re-accepting updated terms.
 */
export function MyData({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = me.deletionRequest;
  const pending = request?.status === "PENDING";

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await api.exportData();
      downloadFile(`my-data-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
      toast("ดาวน์โหลดข้อมูลแล้ว", "success");
    } catch (e) {
      toast(
        e instanceof ApiError && e.status === 429 ? "ดาวน์โหลดได้ชั่วโมงละ 1 ครั้ง กรุณาลองใหม่ภายหลัง" : errorMessage(e),
        "error",
      );
    } finally {
      setExporting(false);
    }
  };

  const save = (updated: MeResponse) => queryClient.setQueryData(qk.me, updated);

  const requestDeletion = async () => {
    setBusy(true);
    setError(null);
    try {
      save(await api.requestDeletion());
      setConfirming(false);
      toast("ส่งคำขอลบบัญชีแล้ว", "success");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancelDeletion = async () => {
    setBusy(true);
    try {
      save(await api.cancelDeletion());
      toast("ยกเลิกคำขอลบบัญชีแล้ว", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 text-sm">
      <p className="text-ink-muted">
        ดาวน์โหลดสำเนาข้อมูลส่วนบุคคลทั้งหมดที่ระบบเก็บเกี่ยวกับคุณ (ไฟล์ JSON) หรือขอลบบัญชีตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล
      </p>
      <Button block variant="secondary" loading={exporting} onClick={() => void exportData()}>
        ดาวน์โหลดข้อมูลของฉัน
      </Button>

      {pending ? (
        <div className="rounded-xl bg-warn-soft p-3 text-ink" role="status">
          <p className="font-semibold">มีคำขอลบบัญชีอยู่</p>
          <p className="mt-1">
            บัญชีจะถูกลบหลัง <strong>{when(request.executeAfter)}</strong> ระบบจะตรวจอีกครั้งก่อนลบว่าคุณไม่ได้อยู่ในวงที่ยังไม่จบและไม่มีหนี้ค้าง
          </p>
          <Button block size="sm" variant="secondary" className="mt-2" loading={busy} onClick={() => void cancelDeletion()}>
            ยกเลิกคำขอลบบัญชี
          </Button>
        </div>
      ) : (
        <>
          {request?.status === "REFUSED" && (
            <p className="rounded-xl bg-danger-soft p-3 text-danger" role="alert">
              คำขอลบบัญชีครั้งล่าสุดไม่สำเร็จ: {request.reason}
            </p>
          )}
          <Button block variant="ghost" className="text-danger" onClick={() => setConfirming(true)}>
            ขอลบบัญชี
          </Button>
        </>
      )}

      <p className="text-center text-xs text-ink-muted">
        <Link to="/terms" className="underline">
          ข้อกำหนดการใช้บริการ
        </Link>{" "}
        ·{" "}
        <Link to="/privacy" className="underline">
          นโยบายความเป็นส่วนตัว
        </Link>
      </p>

      <BottomSheet
        open={confirming}
        onClose={() => {
          setConfirming(false);
          setError(null);
        }}
        title="ยืนยันการขอลบบัญชี"
      >
        <div className="space-y-3 text-sm text-ink-muted">
          <p>
            ระบบจะลบบัญชีหลังระยะรอ ระหว่างนั้นคุณยกเลิกได้ หากคุณยังอยู่ในวงที่ยังไม่จบหรือมีหนี้ผิดนัดค้าง ระบบจะไม่ลบ
            เพราะสมาชิกคนอื่นต้องใช้ข้อมูลของคุณ
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong className="text-ink">ลบ:</strong> รูปบัตร รูปใบหน้า ชื่อจริง เบอร์มือถือ บัญชี LINE พร้อมเพย์ ข้อมูลสำรองกุญแจ และการแจ้งเตือน
            </li>
            <li>
              <strong className="text-ink">เก็บไว้เป็นหลักฐานให้สมาชิกคนอื่น:</strong> ประวัติการเป็นสมาชิกและการชำระ (แสดงเป็น
              “ผู้ใช้ที่ลบบัญชีแล้ว”) และสลิปตามระยะเวลาในนโยบายความเป็นส่วนตัว
            </li>
            <li>
              <strong className="text-ink">ลบไม่ได้:</strong> บันทึกบนเครือข่ายสาธารณะ (ไม่มีชื่อหรือเลขบัตรของคุณ)
            </li>
          </ul>
          <p>หลังลบแล้วจะกู้คืนบัญชีไม่ได้ และคุณจะออกจากระบบทุกเครื่อง</p>
          {error && (
            <p className="rounded-xl bg-danger-soft p-3 text-danger" role="alert">
              {error}
            </p>
          )}
          <Button block variant="danger" loading={busy} onClick={() => void requestDeletion()}>
            ยืนยันขอลบบัญชี
          </Button>
        </div>
      </BottomSheet>
    </Card>
  );
}

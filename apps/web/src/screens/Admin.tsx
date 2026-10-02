import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk, type KycReviewItem } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Header, Screen } from "@/components/layout";
import { useToast } from "@/components/overlay";
import { Button, Card, Chip, EmptyState, ErrorState, Field, Loading } from "@/components/ui";
import { Tabs } from "@/components/widgets";

type Status = "PENDING" | "APPROVED" | "REJECTED";

function Review({ item, onDone }: { item: KycReviewItem; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [reputation, setReputation] = useState(100);
  const [busy, setBusy] = useState(false);

  const decide = async (approve: boolean) => {
    if (!approve && reason.trim().length < 3) return toast("ระบุเหตุผลที่ไม่อนุมัติ", "error");
    setBusy(true);
    try {
      await api.kycDecision(item.id, approve, reason.trim() || undefined, approve ? reputation : undefined);
      toast(approve ? "อนุมัติแล้ว" : "ไม่อนุมัติแล้ว", "success");
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-ink">{item.fullName}</p>
          <p className="text-xs text-ink-muted">
            LINE: {item.displayName} · บัตร ••••{item.nationalIdLast4} · {new Date(item.createdAt).toLocaleString("th-TH")}
          </p>
        </div>
        <Chip tone={item.status === "APPROVED" ? "success" : item.status === "REJECTED" ? "danger" : "warn"}>{item.status}</Chip>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["idCard", "selfie"] as const).map((k) => (
          <a key={k} href={api.kycImageUrl(item.id, k)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-surface">
            <img src={api.kycImageUrl(item.id, k)} alt={k === "idCard" ? "บัตรประชาชน" : "ใบหน้าคู่บัตร"} className="h-32 w-full object-cover" loading="lazy" />
          </a>
        ))}
      </div>
      {item.status === "PENDING" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="คะแนนเริ่มต้น" type="number" min={0} max={1000} value={reputation} onChange={(e) => setReputation(Number(e.target.value))} />
            <Field label="เหตุผล (ถ้าไม่อนุมัติ)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" loading={busy} onClick={() => void decide(true)}>
              อนุมัติ
            </Button>
            <Button className="flex-1" variant="danger" loading={busy} onClick={() => void decide(false)}>
              ไม่อนุมัติ
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function RotateKey() {
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = userId.trim().length > 0 && /^0x[0-9a-fA-F]{40}$/.test(address);
  return (
    <Card className="space-y-3">
      <h3 className="font-semibold text-ink">ย้ายกุญแจให้ผู้ใช้ที่ทำรหัสกู้คืนหาย</h3>
      <p className="text-sm text-ink-muted">ทำหลังยืนยันตัวตนใหม่ (วิดีโอคอลคู่บัตร) แล้วเท่านั้น สมาชิกภาพในทุกวงจะย้ายไปยังกุญแจใหม่ และบันทึกถาวร</p>
      <Field label="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} />
      <Field label="รหัสบัญชีใหม่ (0x…)" value={address} onChange={(e) => setAddress(e.target.value.trim())} className="[&_input]:font-mono" />
      <Button
        block
        variant="danger"
        loading={busy}
        disabled={!valid}
        onClick={async () => {
          if (!window.confirm("ยืนยันการย้ายกุญแจ? ทำย้อนกลับไม่ได้")) return;
          setBusy(true);
          try {
            await api.rotateKey(userId.trim(), address);
            toast("ย้ายกุญแจแล้ว", "success");
            setUserId("");
            setAddress("");
          } catch (e) {
            toast(errorMessage(e), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        ย้ายกุญแจ
      </Button>
    </Card>
  );
}

export default function Admin() {
  const [status, setStatus] = useState<Status>("PENDING");
  const q = useQuery({ queryKey: qk.kyc(status), queryFn: () => api.kycQueue(status) });
  const queryClient = useQueryClient();

  return (
    <Screen>
      <Header title="ตรวจสอบตัวตน (KYC)" back="/profile">
        <Tabs<Status>
          dark
          value={status}
          onChange={setStatus}
          tabs={[
            { id: "PENDING", label: "รอตรวจ" },
            { id: "APPROVED", label: "อนุมัติ" },
            { id: "REJECTED", label: "ไม่อนุมัติ" },
          ]}
        />
      </Header>
      <main className="space-y-3 px-4 py-4">
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title="ไม่มีรายการ" icon="✅" />
        ) : (
          q.data.map((item) => (
            <Review key={item.id} item={item} onDone={() => void queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] })} />
          ))
        )}
        <RotateKey />
      </main>
    </Screen>
  );
}

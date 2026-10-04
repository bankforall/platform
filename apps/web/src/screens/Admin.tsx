import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LEGAL_CAPS, type KeyRotationView } from "@bankforall/shared";
import { api, qk, type KeyRotationStatus, type KycReviewItem } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Header, Screen } from "@/components/layout";
import { useToast } from "@/components/overlay";
import { Button, Card, Chip, EmptyState, ErrorState, Field, KeyValue, Loading } from "@/components/ui";
import { useMe } from "@/hooks/session";
import { shortAddress } from "@/lib/format";
import { Tabs } from "@/components/widgets";

type Status = "PENDING" | "APPROVED" | "REJECTED";

/** Starting reputation after KYC (decisions D2); trusted starts at LEGAL_CAPS.trustedReputation. */
const DEFAULT_REPUTATION = 100;

function Review({ item, onDone }: { item: KycReviewItem; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [reputation, setReputation] = useState(DEFAULT_REPUTATION);
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
          <div className="space-y-2">
            <Field
              label="คะแนนเริ่มต้น"
              type="number"
              min={0}
              max={1000}
              value={reputation}
              onChange={(e) => setReputation(Math.max(0, Math.min(1000, Math.floor(Number(e.target.value) || 0))))}
              hint={`ค่าปกติ ${DEFAULT_REPUTATION} · ${LEGAL_CAPS.trustedReputation} ขึ้นไป = "น่าเชื่อถือ" (รับเงินช่วงครึ่งแรกของวงและรับงวดแรกแบบมือนายวงได้) — ให้เฉพาะผู้ที่ยืนยันรายได้/ชุมชนได้`}
            />
            <Field label="เหตุผล (ถ้าไม่อนุมัติ)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <p className="text-xs text-ink-muted" aria-live="polite">
            จะอนุมัติด้วยคะแนน <strong className="text-ink">{reputation}</strong>
            {reputation >= LEGAL_CAPS.trustedReputation ? " — สมาชิกที่น่าเชื่อถือ" : " — สมาชิกทั่วไป"}
          </p>
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

const rotationStatusText: Record<KeyRotationView["status"], string> = {
  PENDING: "รออนุมัติ",
  APPROVED: "รอครบเวลา",
  EXECUTED: "เปลี่ยนแล้ว",
  CANCELLED: "ยกเลิก",
  FAILED: "ไม่สำเร็จ",
};

function RotationItem({ item, myId, onDone }: { item: KeyRotationView; myId: string | undefined; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const approvedByMe = item.approvals.some((a) => a.adminId === myId);

  const approve = async () => {
    if (!window.confirm(`อนุมัติการเปลี่ยนกุญแจของ ${item.displayName}? ยืนยันตัวตนผู้ขอแล้วใช่ไหม`)) return;
    setBusy(true);
    try {
      const updated = await api.approveKeyRotation(item.id);
      toast(updated.approvals.length >= 2 ? "อนุมัติครบ 2 คนแล้ว จะเปลี่ยนกุญแจหลังครบ 24 ชั่วโมง" : "อนุมัติแล้ว รอผู้ดูแลอีก 1 คน", "success");
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (reason.trim().length < 3) return toast("ระบุเหตุผลที่ไม่อนุมัติ", "error");
    setBusy(true);
    try {
      await api.rejectKeyRotation(item.id, reason.trim());
      toast("ปฏิเสธคำขอแล้ว", "success");
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{item.displayName}</p>
          <p className="text-xs text-ink-muted">
            User ID {item.userId} · ขอเมื่อ {new Date(item.createdAt).toLocaleString("th-TH")}
          </p>
        </div>
        <Chip tone={item.status === "APPROVED" ? "success" : "warn"}>{rotationStatusText[item.status]}</Chip>
      </div>
      <KeyValue label="กุญแจเดิม">
        <span className="font-mono">{shortAddress(item.oldAddress)}</span>
      </KeyValue>
      <KeyValue label="กุญแจใหม่">
        <span className="font-mono">{shortAddress(item.newAddress)}</span>
      </KeyValue>
      <KeyValue label="อนุมัติแล้ว">{item.approvals.length}/2</KeyValue>
      {item.approvals.length > 0 && (
        <ul className="text-xs text-ink-muted">
          {item.approvals.map((a) => (
            <li key={a.adminId}>
              ✓ {a.adminName} · {new Date(a.at).toLocaleString("th-TH")}
            </li>
          ))}
        </ul>
      )}
      {item.executeAfter && (
        <p className="text-xs text-ink-muted">จะเปลี่ยนกุญแจหลัง {new Date(item.executeAfter).toLocaleString("th-TH")} (ผู้ใช้ยกเลิกได้จนถึงเวลานั้น)</p>
      )}
      {item.status === "PENDING" && (
        <>
          <Field label="เหตุผล (ถ้าไม่อนุมัติ)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button className="flex-1" loading={busy} disabled={approvedByMe} onClick={() => void approve()}>
              {approvedByMe ? "คุณอนุมัติแล้ว" : "อนุมัติ"}
            </Button>
            <Button className="flex-1" variant="danger" loading={busy} onClick={() => void reject()}>
              ไม่อนุมัติ
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function KeyRotations() {
  const me = useMe().data;
  const [status, setStatus] = useState<KeyRotationStatus>("PENDING");
  const q = useQuery({ queryKey: qk.keyRotations(status), queryFn: () => api.keyRotations(status) });
  const queryClient = useQueryClient();
  return (
    <section aria-labelledby="key-rotations" className="space-y-3 pt-4">
      <h2 id="key-rotations" className="text-lg font-semibold text-ink">
        คำขอเปลี่ยนกุญแจ
      </h2>
      <p className="text-sm text-ink-muted">
        ผู้ใช้ที่ทำเครื่องหายและลืมรหัสกู้คืนขอย้ายบัญชีไปยังกุญแจใหม่บนเครื่องใหม่ ต้องมีผู้ดูแล 2 คนที่ต่างกันอนุมัติ
        ผู้ขอต้องยืนยันตัวตน (KYC) ผ่านแล้ว ยืนยันตัวตนผู้ขออีกครั้ง (เช่น วิดีโอคอลคู่บัตร) ก่อนอนุมัติ
        กุญแจจะเปลี่ยนหลังการอนุมัติครั้งที่สอง 24 ชั่วโมง และระหว่างนั้นเจ้าของบัญชียกเลิกได้
      </p>
      <Tabs<KeyRotationStatus>
        value={status}
        onChange={setStatus}
        tabs={[
          { id: "PENDING", label: "รออนุมัติ" },
          { id: "APPROVED", label: "อนุมัติครบแล้ว" },
        ]}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title="ไม่มีคำขอ" icon="🔑" />
      ) : (
        q.data.map((item) => (
          <RotationItem
            key={item.id}
            item={item}
            myId={me?.id}
            onDone={() => void queryClient.invalidateQueries({ queryKey: ["admin", "key-rotations"] })}
          />
        ))
      )}
    </section>
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
        <KeyRotations />
      </main>
    </Screen>
  );
}

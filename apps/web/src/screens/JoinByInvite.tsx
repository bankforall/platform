import { Navigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { circleTypeLabel } from "@bankforall/shared";
import { api } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Header, Screen } from "@/components/layout";
import { JoinPanel } from "@/components/JoinPanel";
import { Card, ErrorState, KeyValue, Loading } from "@/components/ui";
import { baht, periodLabel } from "@/lib/format";

export default function JoinByInvite() {
  const { code = "" } = useParams();
  const q = useQuery({ queryKey: ["circles", "invite", code], queryFn: () => api.circleByInvite(code), retry: false });

  if (q.data?.me) return <Navigate to={`/circles/${q.data.id}`} replace />;

  return (
    <Screen>
      <Header title="คำเชิญเข้าวง" back="/circles" />
      <main className="space-y-4 px-4 py-4">
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error) === "ไม่พบข้อมูล" ? "ไม่พบวงจากรหัสเชิญนี้" : errorMessage(q.error)} />
        ) : q.data ? (
          <>
            <Card>
              <h2 className="text-xl font-semibold text-ink">{q.data.name}</h2>
              <p className="mb-2 text-sm text-ink-muted">นายวง {q.data.host.displayName}</p>
              <KeyValue label="ประเภท">{circleTypeLabel[q.data.type]}</KeyValue>
              <KeyValue label="เงินต่องวด">{baht(q.data.principal)} บาท</KeyValue>
              <KeyValue label="ความถี่">{periodLabel(q.data.period)}</KeyValue>
              <KeyValue label="สมาชิก">
                {q.data.memberCount}/{q.data.maxMembers}
              </KeyValue>
              <KeyValue label="กองกลางต่องวด">{baht(BigInt(q.data.principal) * BigInt(q.data.maxMembers))} บาท</KeyValue>
            </Card>
            <JoinPanel circle={q.data} inviteCode={code} />
          </>
        ) : null}
      </main>
    </Screen>
  );
}

import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Header, Screen } from "@/components/layout";
import { CircleCard } from "@/components/CircleCard";
import { Tabs } from "@/components/widgets";
import { Button, EmptyState, ErrorState, Field, LinkButton, Loading } from "@/components/ui";

type Tab = "mine" | "discover";

export default function Circles() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "discover" ? "discover" : "mine";
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  const mine = useQuery({ queryKey: qk.myCircles, queryFn: api.myCircles, enabled: tab === "mine" });
  const discover = useQuery({ queryKey: qk.discover, queryFn: api.discover, enabled: tab === "discover" });
  const q = tab === "mine" ? mine : discover;

  return (
    <Screen>
      <Header title="วงแชร์" right={<LinkButton to="/circles/new" variant="white">+ สร้าง</LinkButton>}>
        <Tabs<Tab>
          dark
          value={tab}
          onChange={(t) => setParams(t === "mine" ? {} : { tab: t }, { replace: true })}
          tabs={[
            { id: "mine", label: "วงของฉัน" },
            { id: "discover", label: "ค้นหาวง" },
          ]}
        />
      </Header>
      <main className="space-y-3 px-4 py-4">
        <form
          className="flex items-end gap-2 rounded-2xl bg-white p-3 shadow-xs"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) navigate(`/join/${encodeURIComponent(code.trim())}`);
          }}
        >
          <Field className="flex-1" label="มีรหัสเชิญ?" placeholder="เช่น KnFsGdeT" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" />
          <Button type="submit" disabled={!code.trim()}>
            ไป
          </Button>
        </form>

        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title={tab === "mine" ? "คุณยังไม่ได้อยู่ในวงใด" : "ยังไม่มีวงสาธารณะที่เปิดรับ"}>
            {tab === "mine" ? "สร้างวงใหม่ หรือใส่รหัสเชิญจากนายวง" : "วงส่วนใหญ่เป็นวงส่วนตัว ขอรหัสเชิญจากนายวงที่คุณรู้จัก"}
          </EmptyState>
        ) : (
          q.data.map((c) => <CircleCard key={c.id} circle={c} />)
        )}
      </main>
    </Screen>
  );
}

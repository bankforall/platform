import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { CircleDetail as Detail } from "@bankforall/shared";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useMe } from "@/hooks/session";
import { Header, Screen } from "@/components/layout";
import { JoinPanel } from "@/components/JoinPanel";
import { statusLabel, typeShort } from "@/components/CircleCard";
import { Tabs } from "@/components/widgets";
import { Chip, ErrorState, Loading } from "@/components/ui";
import { baht, periodLabel } from "@/lib/format";
import MembersTab from "./MembersTab";
import PoolTab from "./PoolTab";
import BiddingTab from "./BiddingTab";
import PaymentTab from "./PaymentTab";
import HistoryTab from "./HistoryTab";

type Tab = "members" | "pool" | "bidding" | "payment" | "history";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "members", label: "สมาชิก", icon: "👥" },
  { id: "pool", label: "กองกลาง", icon: "🏛" },
  { id: "bidding", label: "ประมูล", icon: "✉️" },
  { id: "payment", label: "ชำระ", icon: "💸" },
  { id: "history", label: "ประวัติ", icon: "📜" },
];

export interface TabProps {
  circle: Detail;
  myAddress: `0x${string}` | null;
}

export default function CircleDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "members") as Tab;
  const me = useMe().data!;
  const q = useQuery({ queryKey: qk.circle(id), queryFn: () => api.circle(id), refetchInterval: 15_000 });

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError || !q.data)
    return (
      <Screen>
        <Header title="วงแชร์" back="/circles" />
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      </Screen>
    );

  const c = q.data;
  const st = statusLabel[c.status];
  const props: TabProps = { circle: c, myAddress: (me.walletAddress as `0x${string}` | null) ?? null };

  return (
    <Screen>
      <Header
        title={c.name}
        back="/circles"
        subtitle={
          <span className="inline-flex flex-wrap items-center justify-center gap-2">
            <span>
              {typeShort[c.type]} · {baht(c.principal)} บาท {periodLabel(c.period)}
            </span>
            <Chip tone={st.tone}>{st.text}</Chip>
          </span>
        }
      >
        {c.me && <Tabs<Tab> dark value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={TABS} />}
      </Header>
      <main className="px-4 py-4">
        {c.status === "DRAFT" ? (
          <Loading label="กำลังบันทึกการสร้างวง…" />
        ) : !c.me ? (
          <JoinPanel circle={c} />
        ) : (
          <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
            {tab === "members" && <MembersTab {...props} />}
            {tab === "pool" && <PoolTab {...props} />}
            {tab === "bidding" && <BiddingTab {...props} />}
            {tab === "payment" && <PaymentTab {...props} />}
            {tab === "history" && <HistoryTab {...props} />}
          </div>
        )}
      </main>
    </Screen>
  );
}

import { useEffect } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Header, Screen } from "@/components/layout";
import { EmptyState, ErrorState, Loading, cx } from "@/components/ui";

export default function Notifications() {
  const q = useQuery({ queryKey: qk.notifications, queryFn: api.notifications });
  const queryClient = useQueryClient();
  const unread = q.data?.some((n) => !n.readAt) ?? false;

  useEffect(() => {
    if (!unread) return;
    const t = setTimeout(() => {
      api
        .readNotifications()
        .then(() => queryClient.invalidateQueries({ queryKey: qk.notifications }))
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [unread, queryClient]);

  return (
    <Screen>
      <Header title="การแจ้งเตือน" />
      <main className="px-4 py-4">
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title="ยังไม่มีการแจ้งเตือน" icon="🔔">
            เราจะแจ้งเตือนเมื่อถึงกำหนดจ่าย เปิดประมูล หรือมีคนโอนให้คุณ (และส่งทาง LINE ด้วย)
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {q.data.map((n) => {
              const body = (
                <div className={cx("rounded-2xl bg-white p-4 shadow-xs", !n.readAt && "border-l-4 border-primary")}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-ink">{n.title}</p>
                    <time className="shrink-0 text-xs text-ink-muted" dateTime={n.createdAt}>
                      {new Date(n.createdAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{n.body}</p>
                </div>
              );
              return <li key={n.id}>{n.circleId ? <Link to={`/circles/${n.circleId}`}>{body}</Link> : body}</li>;
            })}
          </ul>
        )}
      </main>
    </Screen>
  );
}

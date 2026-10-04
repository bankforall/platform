import { SOURCE_URL } from "@/lib/source";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { useConfig, useMe } from "@/hooks/session";
import { Button, Field, Loading } from "@/components/ui";
import { Header, Screen } from "@/components/layout";

export default function Login() {
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  const config = useConfig();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));

  if (me.data) return <Navigate to={next} replace />;
  if (config.isLoading) return <Loading />;

  const devLogin = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.devLogin(name.trim());
      await queryClient.invalidateQueries({ queryKey: qk.me });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={false}>
      <Header title="เข้าสู่ระบบ" back="/welcome" />
      <main className="px-6 pt-10">
        <h2 className="text-center text-3xl font-semibold text-ink">ยินดีต้อนรับ!</h2>
        <p className="mt-2 text-center text-ink-muted">เข้าสู่ระบบด้วยบัญชี LINE ของคุณ</p>

        {error && (
          <p className="mt-6 rounded-xl bg-danger-soft p-3 text-center text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {config.data?.lineLoginEnabled !== false && (
          <a
            href={api.lineLoginUrl(next)}
            className="mt-10 flex w-full items-center justify-center gap-3 rounded-xl bg-[#06C755] px-5 py-3.5 font-semibold text-white hover:bg-[#05b34c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#06C755]"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden fill="currentColor">
              <path d="M12 3C6.48 3 2 6.6 2 11.05c0 3.99 3.55 7.33 8.34 7.96.33.07.77.21.88.49.1.25.07.64.03.9l-.14.85c-.04.25-.2.98.86.53 1.06-.45 5.73-3.37 7.82-5.78C21.23 14.43 22 12.82 22 11.05 22 6.6 17.52 3 12 3z" />
            </svg>
            เข้าสู่ระบบด้วย LINE
          </a>
        )}

        {config.data?.devLoginEnabled && (
          <form onSubmit={devLogin} className="mt-10 rounded-2xl border border-dashed border-warn bg-warn-soft p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-700">โหมดทดสอบ (ปิดใน production)</p>
            <Field label="ชื่อที่แสดง" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
            <Button type="submit" block className="mt-3" loading={busy} disabled={name.trim().length < 2}>
              เข้าสู่ระบบแบบทดสอบ
            </Button>
          </form>
        )}

        <p className="mt-10 text-center text-xs text-ink-muted">
          การเข้าสู่ระบบถือว่าคุณยอมรับ{" "}
          <Link to="/terms" className="underline">
            ข้อกำหนดการใช้งาน
          </Link>{" "}
          และ{" "}
          <Link to="/privacy" className="underline">
            นโยบายความเป็นส่วนตัว
          </Link>{" "}
          ซึ่งจะแสดงให้อ่านในขั้นตอนถัดไป
        </p>
        <p className="mt-3 text-center text-xs text-ink-muted">
          <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="underline">
            ซอร์สโค้ด (AGPL-3.0)
          </a>
        </p>
      </main>
    </Screen>
  );
}

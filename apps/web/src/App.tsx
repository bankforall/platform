import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useLocalAddress, useMe } from "@/hooks/session";
import { errorMessage } from "@/api/client";
import { ErrorState, Loading } from "@/components/ui";
import { sameAddress } from "@/lib/format";

import Welcome from "@/screens/Welcome";
import Login from "@/screens/Login";
import Home from "@/screens/Home";

const HowItWorks = lazy(() => import("@/screens/HowItWorks"));
const Onboarding = lazy(() => import("@/screens/onboarding/Onboarding"));
const Restore = lazy(() => import("@/screens/Restore"));
const Circles = lazy(() => import("@/screens/Circles"));
const CreateCircle = lazy(() => import("@/screens/CreateCircle"));
const CircleDetail = lazy(() => import("@/screens/circle/CircleDetail"));
const JoinByInvite = lazy(() => import("@/screens/JoinByInvite"));
const Notifications = lazy(() => import("@/screens/Notifications"));
const Profile = lazy(() => import("@/screens/Profile"));
const Admin = lazy(() => import("@/screens/Admin"));

/**
 * Gate for the signed-in app:
 *  - logged out → /welcome
 *  - onboarding steps left (except a pending KYC review) → /onboarding
 *  - account has a key but this device does not → /restore
 */
function RequireApp({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const me = useMe();
  const local = useLocalAddress();
  const location = useLocation();

  if (me.isLoading || local.isLoading) return <Loading />;
  if (me.isError) return <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />;
  if (!me.data) return <Navigate to={`/welcome?next=${encodeURIComponent(location.pathname)}`} replace />;

  // Staff review KYC from /admin; they do not need the member onboarding (phone, wallet, own KYC).
  if (admin) return me.data.role === "ADMIN" ? <>{children}</> : <Navigate to="/" replace />;

  const blocking = me.data.onboarding.filter((s) => !(s === "kyc" && me.data!.kycStatus === "PENDING"));
  if (blocking.length > 0) return <Navigate to="/onboarding" replace />;
  if (me.data.walletAddress && !sameAddress(me.data.walletAddress, local.data)) return <Navigate to="/restore" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/restore" element={<Restore />} />
        <Route path="/" element={<RequireApp><Home /></RequireApp>} />
        <Route path="/circles" element={<RequireApp><Circles /></RequireApp>} />
        <Route path="/circles/new" element={<RequireApp><CreateCircle /></RequireApp>} />
        <Route path="/circles/:id" element={<RequireApp><CircleDetail /></RequireApp>} />
        <Route path="/join/:code" element={<RequireApp><JoinByInvite /></RequireApp>} />
        <Route path="/notifications" element={<RequireApp><Notifications /></RequireApp>} />
        <Route path="/profile" element={<RequireApp><Profile /></RequireApp>} />
        <Route path="/admin" element={<RequireApp admin><Admin /></RequireApp>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

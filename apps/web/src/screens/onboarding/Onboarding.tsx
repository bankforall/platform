import { Navigate, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/session";
import { qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { Header, Screen } from "@/components/layout";
import { Button, ErrorState, Loading } from "@/components/ui";
import PhoneStep from "./PhoneStep";
import PromptPayStep from "./PromptPayStep";
import ConsentStep from "./ConsentStep";
import WalletStep from "./WalletStep";
import KycStep from "./KycStep";

const ALL = ["phone", "promptpay", "consent", "wallet", "kyc"] as const;
const TITLES: Record<(typeof ALL)[number], string> = {
  phone: "ยืนยันเบอร์โทรศัพท์",
  promptpay: "บัญชีรับเงิน",
  consent: "ข้อตกลงการใช้งาน",
  wallet: "ตั้งค่าความปลอดภัย",
  kyc: "ยืนยันตัวตน",
};

export default function Onboarding() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (me.isLoading) return <Loading />;
  if (me.isError) return <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />;
  if (!me.data) return <Navigate to="/welcome" replace />;

  const step = me.data.onboarding[0];
  const done = () => void queryClient.invalidateQueries({ queryKey: qk.me });

  if (!step || (step === "kyc" && me.data.kycStatus === "PENDING")) {
    return (
      <Screen nav={false}>
        <Header title={step ? "รอตรวจสอบตัวตน" : "พร้อมใช้งาน"} />
        <main className="flex flex-col items-center px-6 py-12 text-center">
          <div className="text-6xl" aria-hidden>
            {step ? "⏳" : "👍"}
          </div>
          <h2 className="mt-6 text-2xl font-semibold text-ink">{step ? "ส่งข้อมูลยืนยันตัวตนแล้ว" : "สร้างบัญชีสำเร็จ!"}</h2>
          <p className="mt-2 text-ink-muted">
            {step
              ? "เจ้าหน้าที่จะตรวจสอบภายใน 1 วันทำการ ระหว่างนี้คุณดูวงแชร์ได้ แต่จะสร้างหรือเข้าร่วมวงได้หลังผ่านการตรวจสอบ"
              : "บัญชีของคุณพร้อมแล้ว เริ่มสร้างหรือเข้าร่วมวงแชร์ได้เลย"}
          </p>
          <Button block className="mt-10" onClick={() => navigate("/", { replace: true })}>
            ไปหน้าแรก
          </Button>
        </main>
      </Screen>
    );
  }

  const index = ALL.indexOf(step);
  return (
    <Screen nav={false}>
      <Header title={TITLES[step]} subtitle={`ขั้นตอนที่ ${index + 1} จาก ${ALL.length}`}>
        <div className="flex gap-1.5" aria-hidden>
          {ALL.map((s, i) => (
            <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-white" : "bg-white/30"}`} />
          ))}
        </div>
      </Header>
      <main className="px-5 py-6">
        {step === "phone" && <PhoneStep onDone={done} />}
        {step === "promptpay" && <PromptPayStep me={me.data} onDone={done} />}
        {step === "consent" && <ConsentStep me={me.data} onDone={done} />}
        {step === "wallet" && <WalletStep me={me.data} onDone={done} />}
        {step === "kyc" && <KycStep me={me.data} onDone={done} />}
      </main>
    </Screen>
  );
}

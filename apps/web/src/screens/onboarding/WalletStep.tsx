import { useQueryClient } from "@tanstack/react-query";
import { privateKeyToAccount } from "viem/accounts";
import { walletProofMessage, type MeResponse } from "@bankforall/shared";
import { api } from "@/api/endpoints";
import { KeySetup } from "@/components/KeySetup";
import { Button } from "@/components/ui";

export default function WalletStep({ me, onDone }: { me: MeResponse; onDone: () => void }) {
  const queryClient = useQueryClient();
  return (
    <KeySetup
      intro={(start) => (
        <div className="space-y-5">
          <div className="text-center text-6xl" aria-hidden>
            🔐
          </div>
          <h2 className="text-center text-xl font-semibold text-ink">ลายเซ็นดิจิทัลของคุณ</h2>
          <p className="text-ink-muted">
            ทุกการกระทำในวงแชร์ (เข้าวง ประมูล แจ้งโอน ยืนยันรับเงิน) จะถูกลงนามด้วยกุญแจที่สร้างและเก็บไว้บนเครื่องนี้เท่านั้น
            บริษัทไม่สามารถทำรายการแทนคุณได้ — หลักฐานจึงมีน้ำหนัก
          </p>
          <ul className="space-y-2 rounded-2xl bg-white p-4 text-sm text-ink shadow-xs">
            <li>1. ตั้ง PIN 6 หลักสำหรับยืนยันทุกรายการ</li>
            <li>2. จดรหัสกู้คืนบัญชี ใช้เมื่อเปลี่ยนหรือทำโทรศัพท์หาย</li>
          </ul>
          <Button block onClick={start}>
            เริ่มตั้งค่า
          </Button>
        </div>
      )}
      onCreated={async ({ privateKey, address, backup }) => {
        const proof = await privateKeyToAccount(privateKey).signMessage({ message: walletProofMessage(me.id, address) });
        await api.registerWallet(address, proof, backup);
        await queryClient.invalidateQueries({ queryKey: ["localAddress"] });
        onDone();
      }}
    />
  );
}

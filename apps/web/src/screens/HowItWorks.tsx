import { Header, Screen } from "@/components/layout";
import { APP_NAME } from "@/lib/brand";
import { Card, LinkButton } from "@/components/ui";

const steps = [
  {
    title: "1. สร้างวงหรือเข้าร่วมวง",
    body: "นายวงกำหนดประเภทวง เงินต่องวด จำนวนมือ ความถี่ และวันเริ่ม แล้วส่งรหัสเชิญให้เพื่อนที่ไว้ใจ",
  },
  {
    title: "2. ส่งเงินทุกงวด",
    body: "ทุกงวดสมาชิกโอนเงินตามยอดที่ระบบคำนวณให้ผู้รับของงวดนั้นโดยตรงผ่านพร้อมเพย์ แล้วอัปโหลดสลิป ผู้รับกดยืนยันว่าได้รับเงิน",
  },
  {
    title: "3. ตัดสินผู้รับเงินกองกลาง",
    body: "วงแบบประมูลใช้การยื่นซองปิด (ไม่มีใครเห็นราคาของกันและกันจนเปิดซอง) ผู้เสนอสูงสุดได้รับเงิน วงแบบเลือกที่นั่งได้รับตามลำดับที่นั่ง",
  },
  {
    title: "4. รับเงินและวนจนครบ",
    body: "แต่ละคนได้รับเงินกองกลางเพียงครั้งเดียว วนจนครบทุกคน ใครไม่จ่ายตามกำหนดจะถูกบันทึกว่าผิดนัด และใช้เป็นหลักฐานได้",
  },
];

const types = [
  { name: "เลือกที่นั่ง (Fix)", body: "จองลำดับที่ได้รับเงินไว้ล่วงหน้า ที่นั่งแรกจ่ายต่องวดมากกว่า ที่นั่งท้ายจ่ายน้อยกว่า ทุกคนได้รับยอดเท่ากัน" },
  { name: "ประมูลดอกตาม (Float)", body: "เสนอดอกเบี้ยที่ยอมจ่าย ผู้ชนะต้องจ่ายเงินต้น + ดอกในทุกงวดที่เหลือ" },
  { name: "ประมูลดอกหัก (Discount)", body: "เสนอส่วนลด คนที่ยังไม่ได้รับเงินจ่ายน้อยลงตามส่วนลดของงวดนั้น" },
];

export default function HowItWorks() {
  return (
    <Screen nav={false}>
      <Header title="วงแชร์ทำงานอย่างไร" back />
      <main className="space-y-4 px-4 py-6">
        <Card>
          <h2 className="font-semibold text-ink">วงแชร์ (ROSCA) คืออะไร?</h2>
          <p className="mt-2 text-sm text-ink-muted">
            การออมเงินร่วมกันที่มีมาทั่วโลก — เม็กซิโกเรียก Tanda, ไนจีเรีย Esusu, อินเดีย Chit Fund, ฟิลิปปินส์ Paluwagan, จีน Hui และไทยเรียก
            “เปียแชร์” สมาชิกทุกคนส่งเงินเท่ากันทุกงวด และผลัดกันรับเงินก้อนจนครบทุกคน
          </p>
        </Card>
        {steps.map((s) => (
          <Card key={s.title}>
            <h3 className="font-semibold text-primary">{s.title}</h3>
            <p className="mt-1 text-sm text-ink-muted">{s.body}</p>
          </Card>
        ))}
        <Card>
          <h2 className="font-semibold text-ink">ประเภทวง</h2>
          <dl className="mt-2 space-y-3 text-sm">
            {types.map((t) => (
              <div key={t.name}>
                <dt className="font-medium text-ink">{t.name}</dt>
                <dd className="text-ink-muted">{t.body}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="bg-warn-soft">
          <p className="text-sm text-ink">
            <strong>สำคัญ:</strong> {APP_NAME} เป็นเพียงเครื่องมือจดบันทึกและบังคับกติกา บริษัทไม่ใช่นายวงและไม่ถือเงินของสมาชิก
            ควรเล่นแชร์กับคนที่คุณรู้จักและไว้ใจเท่านั้น
          </p>
        </Card>
        <LinkButton to="/login" block>
          เริ่มต้นใช้งาน
        </LinkButton>
      </main>
    </Screen>
  );
}

# Bank For All v2 — ออกแบบใหม่เพื่อใช้งานจริง

[← เอกสารระบบเดิม](../README.md)

## เป้าหมายและการตัดสินใจหลัก

| เรื่อง | ตัดสินใจแล้ว | เหตุผล |
| --- | --- | --- |
| เงิน | **ระบบไม่ถือเงิน** — สมาชิกโอนกันเองผ่าน PromptPay | ไม่ต้องขอใบอนุญาต e-money/P2P และเริ่มได้เร็ว |
| Blockchain | **Smart contract เต็มรูปแบบ** ทำหน้าที่ตัดสินผู้รับ บังคับกติกา และเก็บหลักฐาน โดย **ไม่มีเงินหรือโทเคน** | หลักฐานปลอมไม่ได้ และผู้ใช้ลงนามเองจึงปฏิเสธภายหลังไม่ได้ (pain point "digital evidence" ใน Issue #11) |
| Platform | Mobile web (PWA) + LINE Login + LINE แจ้งเตือน | onboarding ง่ายและต่อยอดจาก design เดิม |
| Design | รวม Figma "Debt/Invest" + "Blockathon" | ดู [screen inventory](../../design/screen-inventory.md) |

## เอกสาร

| ไฟล์ | เนื้อหา |
| --- | --- |
| [rules-spec.md](./rules-spec.md) | กติกาวงแชร์ (Fix ที่นั่ง ±rate, Float, Discount), การประมูลปิดซอง, การชำระ, การผิดนัด |
| [architecture.md](./architecture.md) | สถาปัตยกรรมที่สร้างจริง, ลำดับการทำรายการ, worker, ความปลอดภัย, ข้อจำกัด |
| [deployment.md](./deployment.md) | วิธี deploy ขึ้น production, จัดการกุญแจ, งานประจำ, การกู้คืน, checklist ก่อนเปิดใช้งาน |
| [decisions.md](./decisions.md) | การตัดสินใจกติกาที่เคยค้าง: หักกลบหนี้, สมาชิกที่น่าเชื่อถือ, เพดานดอก 15%/ปี, วงที่ถูกทิ้ง, ระงับผู้ผิดนัด, pause |
| [security.md](./security.md) | Security model, ผลการตรวจความปลอดภัยก่อนเปิดใช้งาน และความเสี่ยงที่ยอมรับ |
| [legal-checklist.md](./legal-checklist.md) | คำถามด้านกฎหมายที่ต้องปิดก่อนเปิดใช้งานจริง |
| [`design/screen-inventory.md`](../../design/screen-inventory.md) | 63 หน้าจอจาก Figma → หน้าจอ v2 (ใช้ / ปรับ / ตัด / เพิ่ม) |

## สิ่งที่ยังขาด (สรุปจากการวิเคราะห์)

1. **กฎหมาย** — พ.ร.บ.การเล่นแชร์ 2534 (นิติบุคคลห้ามเป็นนายวง + มีเพดาน), PDPA, ธปท. → [legal-checklist.md](./legal-checklist.md)
2. **กติกาที่ชัดเจน** — ระบบเดิมไม่มีสูตรคำนวณ → [rules-spec.md](./rules-spec.md) และทดสอบแล้ว
3. **การยืนยันตัวตน (KYC) และคะแนนความน่าเชื่อถือ** — ระบบเดิมใช้ค่า hardcode
4. **การจัดการคนเบี้ยว** — grace period, ผิดนัด, dispute, Evidence Pack
5. **การชำระจริง** — PromptPay QR + ตรวจสลิป
6. **การแจ้งเตือน** — LINE Messaging
7. **คุณภาพ** — test, CI, audit contract

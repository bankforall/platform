# Screen Inventory — Bank For All v2

ที่มา: `figma-export/debt-invest/` (63 ไฟล์ จากไฟล์ Figma "Debt/Invest" ที่ผู้ใช้ส่งมา 2026-10-02)
และหน้าจอใน repo `bank4all-blockathon2023Frontend` (ไฟล์ Figma "Blockathon" — **ยังไม่ได้ export มา** จึงใช้โค้ด Vue แทน)

สถานะ: ✅ ใช้ได้เลย · ✏️ ใช้แต่ต้องปรับ · ⏸ เลื่อนไป Phase 3 · ❌ ตัดทิ้ง · 🆕 ต้องออกแบบเพิ่ม

> หลักที่ทำให้ต้องปรับหลายหน้า: v2 **ไม่ถือเงิน** (โอนกันเองผ่าน PromptPay) จึงไม่มี "ยอดเงินในกระเป๋า" หรือการฝาก/ถอน
> หน้าแรกจึงเปลี่ยนจาก "มีเงินเท่าไร" เป็น "ต้องจ่ายใคร เท่าไร เมื่อไร / จะได้รับเมื่อไร"

## 1. Onboarding

| ไฟล์ | หน้าจอ v2 | สถานะ | สิ่งที่ต้องปรับ |
| --- | --- | --- | --- |
| `Bank Screen.png`, `Bank Screen@2x.png` | Splash | ✅ | |
| — (Blockathon `/how-it-works-2…6`) | How it works (4 ขั้น + ROSCA คืออะไร) | ✏️ | ย้ายมาใช้ style ของ Debt/Invest |
| `Sign Up Screen.png`, `Sign In Screen.png` | เข้าสู่ระบบด้วย LINE | ✏️ | เปลี่ยนฟอร์ม email/password เป็นปุ่ม "เข้าสู่ระบบด้วย LINE" อันเดียว |
| `Mobile Number Register Screen.png` | กรอกเบอร์โทร | ✅ | ใช้ส่ง OTP |
| `Verifying Nummber Screen.png` | ยืนยัน OTP | ✏️ | OTP 6 หลัก (ตาม SMS provider) |
| `Touch id Confirmation Screen.png` | เปิดใช้ passkey / Face ID | ✏️ | ใช้ยืนยันการ "ลงนาม" ประมูลและยืนยันรับเงิน (กุญแจของ embedded wallet) |
| `Touch id Confirmation Screen Copy.png` (Set PIN) | ตั้ง PIN | ✅ | ใช้แทน passkey ในเครื่องที่ไม่รองรับ |
| `Account Created Screen.png` | สร้างบัญชีสำเร็จ | ✅ | |
| — | PromptPay ID ของฉัน (ใช้รับเงินเมื่อเป็นผู้รับ) | 🆕 | |
| — | ยอมรับเงื่อนไข + PDPA consent | 🆕 | ระบุว่าบริษัทไม่ใช่นายวงและไม่ถือเงิน |
| — | KYC: ถ่ายบัตรประชาชน, selfie, สถานะการตรวจ | 🆕 | ต้องผ่านก่อนสร้างหรือเข้าวง |

## 2. Home

| ไฟล์ | หน้าจอ v2 | สถานะ | สิ่งที่ต้องปรับ |
| --- | --- | --- | --- |
| `Dashboard.png`, `Dashboard after.png` | Home | ✏️ | การ์ดหลักเปลี่ยนจาก "Total Savings" เป็น "งวดถัดไป: จ่าย X บาท ให้ Y ภายใน …" และ "รอบที่คุณจะได้รับ"; ตัด Save/Invest slider |
| `Money Summary Screen.png`, `… after bid.png` | สรุปภาระและสิทธิ์ทุกวง | ✏️ | แสดง "จ่ายไปแล้ว / ต้องจ่ายอีก / ได้รับแล้ว / จะได้รับ" แทนยอดคงเหลือ; ตัดการ์ด Microfinance |
| `Addmoney.png`, `Withdraw.png` | — | ❌ | ระบบไม่ถือเงิน |
| `Success Added.png`, `Fail withdraw.png`, `Success withdraw.png`, `Fail Added.png` | Result state (สำเร็จ/ไม่สำเร็จ) | ✏️ | ใช้เป็น component ผลลัพธ์ทั่วไป (บันทึกแล้ว, ตรวจสลิปไม่ผ่าน ฯลฯ); `Fail withdraw` ใช้ไอคอนติ๊กถูก → เปลี่ยนเป็นไอคอน error |

## 3. Peer share — ค้นหาและสร้างวง

| ไฟล์ | หน้าจอ v2 | สถานะ | สิ่งที่ต้องปรับ |
| --- | --- | --- | --- |
| `Lending peer share dashboard.png`, `…-1.png` | วงของฉัน + ค้นหาวง | ✏️ | header ตัด Saving/Microfinance balance และ D/E; "Credit Score" → "คะแนนความน่าเชื่อถือ"; การ์ดวงใช้ได้ดี (Pool, ต่อวัน, Join/Joined) |
| — (Blockathon `/discover`, `/enter-password`) | ค้นหาวง / ใส่รหัสเชิญ | ✏️ | |
| `Lending peer share create room.png` | Wizard สร้างวง | ✏️ | ฟิลด์ใน design: ชื่อวง, เงินต่องวด, เครดิตขั้นต่ำ, จำนวนมือ, ประเภท (Fix ±rate / Float), วงปิด+รหัส/วงเปิด, รหัสเชิญ, วันครบกำหนด, ความถี่ (daily…monthly) → เพิ่ม: Discount, มือนายวงรอบแรก, ช่วงประมูล/เปิดซอง/ชำระ/ผ่อนผัน, **ตารางจำลองรับ-จ่ายทุกรอบ** (`simulateCircle`) และคำเตือนเพดานตามกฎหมาย |

## 4. ในวงแชร์

| ไฟล์ | หน้าจอ v2 | สถานะ | สิ่งที่ต้องปรับ |
| --- | --- | --- | --- |
| `Lending fix peer share Sit in.png` | **Fix: เลือกที่นั่ง** | ✅ | เป็นที่มาของสูตร seat ladder ใน `circle-math.ts` (ที่นั่ง 1 จ่าย 1,100 … ที่นั่ง 5 จ่าย 900) — ⚠️ design ระบุที่นั่ง 5 "paid 5,500" ซึ่งควรเป็น 4,500 และ header เขียน 10 คนแต่มี 5 ที่นั่ง |
| `Lending fix peer share dashboard.png` | Fix: ลำดับการรับ (Order) | ✅ | |
| `Lending fix peer share pool.png`, `peer share room Pool*.png` | Pool + รายชื่อพร้อมสถานะรอบ | ✏️ | donut = สัดส่วนของแต่ละคน; เพิ่ม timeline ของรอบ; ป้าย `Lent`/`Bid-able` → "ได้รับแล้ว"/"ประมูลได้" + "ค้างจ่าย"/"ผิดนัด" |
| `peer share room Member*.png` | สมาชิก | ✏️ | ตัด "All contacts / Add / DM" (ไม่ทำ social graph) → ปุ่มเปิดแชท LINE |
| `peer share room Bidding.png`, `… after bid.png` | ประมูล (Float/Discount) | ✏️ | ประมูลแบบปิดซอง 2 ขั้น: "ยื่นซอง" (ซ่อนจำนวน) → "เปิดซอง" ในช่วง reveal พร้อม countdown; สรุป "My Bidding" ในหน้านี้ใช้ได้ |
| `Won Bidding.png` | ชนะการประมูล | ✅ | ข้อความ: ได้รับ X บาท ดอก Y ต่องวด |
| `peer share room Payment.png`, `… after bid.png` | จ่ายงวด | ✏️ | ตัดไอคอน Mastercard/Bankwest/PayPal และ barcode → **PromptPay QR ของผู้รับ** + ปุ่มอัปโหลดสลิป + สถานะ (ส่งแล้ว / ตรวจสลิปผ่าน / ผู้รับยืนยันแล้ว) |
| `Receipt Screen.png`, `Receipt Screen-1.png` | ใบบันทึกการจ่าย | ✏️ | "Reference number" → เลขอ้างอิงที่ตรวจสอบได้ (tx hash ย่อ) + "บันทึกถาวรแล้ว ✓"; ตัด "Transfer fee" และ "arrive within 48 hours" |
| `Contact List*.png` (15 ไฟล์) | component `MemberRow` | ✏️ | เป็น state ต่างๆ ของแถวสมาชิก (Add, DM, Lent, Bid-able, Approve, Wait, Reserve, Sit chair) → ทำเป็น component เดียวที่มี status variants |
| — | ผู้รับ: ยืนยันการรับเงินทีละคน | 🆕 | |
| — | ค้างจ่าย / ผิดนัด / แจ้งปัญหา (dispute) | 🆕 | |
| — | ดาวน์โหลด Evidence Pack (PDF) | 🆕 | |

## 5. Microfinance — ⏸ Phase 3 (ต้องมีใบอนุญาต)

`Microfinance Main Screen.png`, `Lending Microfinace dashboard.png`, `… Request lending.png`, `… Approval lending.png`,
`… Total vote my project.png / approve / Reject`, `… Portfolio*.png` (3), `Lending Microfinance redeem code.png`, `… redeem success.png`

แนวคิดใน design: กลุ่มปล่อยกู้ (เช่น "Jodd fair group") ที่มีเงื่อนไขการเข้ากลุ่ม (D/E < 2, เงินออมขั้นต่ำ, กู้ได้สูงสุด 24 เดือน)
สมาชิกยื่นขอกู้พร้อมแผนธุรกิจ และต้องได้ **โหวตอนุมัติ 100%** มี pool, reserve 10% และระบบ referral code
→ เป็นการให้สินเชื่อ ซึ่งต้องมีใบอนุญาตจาก ธปท. จึงไม่อยู่ใน MVP — เก็บ design ไว้ใช้ในอนาคต

## 6. หน้าที่ต้องออกแบบเพิ่ม (🆕) — สรุป

1. เข้าสู่ระบบด้วย LINE
2. PromptPay ID
3. Consent / PDPA
4. KYC 3 หน้า
5. ตารางจำลองในหน้าสร้างวง
6. Timeline รอบ
7. ประมูลปิดซอง (ยื่น/เปิดซอง)
8. อัปโหลดสลิป + สถานะ
9. ผู้รับยืนยันรับเงิน
10. ค้างจ่าย/ผิดนัด
11. Dispute
12. Evidence Pack
13. การแจ้งเตือน
14. โปรไฟล์ + คะแนนความน่าเชื่อถือ + ประวัติ

## 7. Design tokens ที่พบ

| Token | ค่า | หมายเหตุ |
| --- | --- | --- |
| primary | `#7165E3` | สีหลักของ peer share, ปุ่ม |
| primary-active | `#7C6EFF` / `#665AD9` | แท็บ active/inactive |
| ink | `#1C1939` | หัวข้อ |
| surface | `#F9F9FB`, `#F7F7F7` | พื้นหลัง, input |
| accent-blue | `#0066F6` | การ์ด Dashboard/Microfinance — **ไม่สอดคล้องกับ primary** แนะนำให้รวมเป็นสีม่วง |
| accent-yellow | `#FFBF1E` | ปุ่ม "Go" |
| success | เขียว (Bid-able, Sit chair, Approve) | |
| font | DM Sans | ควรเพิ่มฟอนต์ไทย เช่น IBM Plex Sans Thai / Noto Sans Thai |
| frame | 414×896 (iPhone 11) | mobile-first |

## 8. สิ่งที่ต้องการจากทีม design

- export ไฟล์ Figma **Blockathon** แบบเดียวกัน (PNG) เพื่อตัดสินว่าหน้า How it works, Discover และ Create room จะใช้ของไฟล์ไหน
- ยืนยันตัวเลขที่ไม่ตรงกันในหน้า "Sit in" (ที่นั่ง 5 จ่าย 5,500 และ header เขียน 10 คน)
- ออกแบบหน้า 🆕 ทั้ง 14 หน้า และ export component `MemberRow`

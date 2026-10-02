# Domain และแนวคิดผลิตภัณฑ์

[← กลับหน้าหลัก](./README.md)

## 1. ปัญหาที่ต้องการแก้

จาก Issue [#11](https://github.com/bankforall/bank4all/issues/11) และ [#21](https://github.com/bankforall/bank4all/issues/21) ใน repo `bank4all`:

- มีการเล่น **เปียแชร์ผ่าน Facebook Group / LINE** กับคนไม่รู้จักในวงเงินสูงจริง และมีการโกงเกิดขึ้นจริง
- ผู้เล่นกลุ่มนี้ **รับความเสี่ยงและดอกเบี้ยสูงได้** — แสดงว่ามี demand สำหรับแหล่งเงินทุนนอกระบบธนาคาร
- ต้องการ:
  1. **Digital evidence** ของการเล่นแชร์ เพื่อใช้เป็นหลักฐานหากมีการโกง
  2. **Hub/Marketplace สำหรับ micro-loan** ระหว่างนักลงทุนรายย่อยกับคนที่ต้องการเงินทุน (ไม่ผ่านเกณฑ์ธนาคาร, freelance ฯลฯ)
  3. **การยืนยันตัวตน** (เสนอ NDID, Digital ID ของ DOPA)
  4. **กลไกบังคับกติกา** ผ่านระบบ เพื่อสร้าง trust แทนการเชื่อใจตัวบุคคล (ท้าวแชร์)

### ทำไมเป็น Web App แทน LINE Chatbot / FB Group (ข้อสรุปจากทีม)
- ตัดท้าวแชร์/คนกลางออก → ต้นทุนต่ำลง, ทุกคนเป็น "มือแรก" ได้
- บังคับใช้กติกาได้โดยตรง (LINE chatbot ทำได้แค่ book-keeping เป็นพยาน)
- เพิ่มการ verify, collateral, transparency
- ข้อเสีย: onboarding ยากกว่า LINE ซึ่ง friction ต่ำ

### กลุ่มเป้าหมาย (สมมติฐาน)
1. กลุ่มเล่นแชร์ออนไลน์ — รับความเสี่ยงสูง ยอมจ่ายดอกเยอะ
2. กลุ่ม traditional — ท้าทายด้านพฤติกรรม แต่เริ่มใช้ e-banking/เป๋าตัง มากขึ้น
3. Freelance / คนไม่มี stable cash flow

### คำถามวิจัยที่ยังค้าง (Issue #21)
- กฎหมาย: ธปท. นับเป็น "การกู้ยืม" หรือไม่? ก.ล.ต. นับเงินในระบบเป็น Digital Asset หรือไม่?
- ระบบควรเป็นแค่ "ผู้จดบันทึก" (เงินโอนผ่าน PromptPay ตรงระหว่างสมาชิก) หรือเป็น "Wallet/ผู้ถือเงิน" (บังคับกติกาได้มากกว่าแต่รับผิดชอบมากกว่า)?
- จะประเมินความน่าเชื่อถือผู้ใช้อย่างไร — D/E ratio, Credit Score (Credit Bureau เข้าถึงได้เฉพาะธนาคาร)
- กรณีประมูลเท่ากัน: ประมูลใหม่จนเหลือผู้ชนะคนเดียว หรือ weight ด้วย credit score
- เมื่อย้ายไปใช้ blockchain ควรเก็บอะไร on-chain / off-chain

## 2. เปียแชร์ (ROSCA) คืออะไร

**ROSCA (Rotating Savings and Credit Association)** — สมาชิก N คน จ่ายเงินเข้ากองกลางเท่ากันทุกงวด
แต่ละงวดจะมีสมาชิก 1 คนได้รับเงินกองกลางทั้งก้อน วนจนครบ N งวด (ทุกคนได้รับครั้งเดียว)

ชื่อเรียกในประเทศต่างๆ (จาก UI Blockathon): Mexico: *Tanda*, Nigeria: *Esusu*, India: *Chit Fund*,
South Africa: *Stokvel*, Philippines: *Paluwagan*, China: *Hui*, Thailand: *เปียแชร์*

### ประเภทวงแชร์

| ประเภท | วิธีเลือกผู้รับเงินในแต่ละรอบ | ใน code |
| --- | --- | --- |
| **Fix** | กำหนดลำดับ/ตำแหน่งไว้ล่วงหน้า ("Choose position in fixed cost") | `typeRoom: "Fix"` (`api`), `mainType: 'Fix'` (smartcontract — ยังไม่ implement) |
| **Float** | ประมูล — **ผู้เสนอดอกเบี้ยสูงสุดชนะ** ("Highest bidder win") | `typeRoom: "Float"`, `mainType: 'Float'` (implement ใน smartcontract) |
| **Discount** | ประมูล — ผู้เสนอส่วนลดต่ำสุดชนะ ("lowest discount bidder win") | มีเฉพาะใน UI Blockathon |

แนวคิดเรื่องความเสี่ยง (จาก comment ของ mmenuu ใน #11):
- **Fix** ช่วยคนที่ยังไม่มีเครดิต — เข้าร่วมได้แต่มักได้ลำดับท้าย จึงเป็นการบังคับออมก่อน ลดความเสี่ยงการโกง
- **Float** ถ้าประมูลเท่ากัน คนเครดิตสูงกว่าได้ก่อน; คนเครดิตต่ำมีข้อจำกัดการ join pool ที่มูลค่าสูงเกินเงินออม

### ขั้นตอน (จาก UI "How it works" ของ Blockathon)

1. **Create room** — เลือกประเภท, policy, ระยะเวลา, สกุลเงิน, pool size, ผู้ที่เข้าร่วมได้
   (ตัวอย่าง: "Fix peer share 6 members, $100 per person, 1 per month")
2. **Contribution** — สมาชิกทุกคนจ่ายเงินจำนวนเท่ากันเข้ากองกลางตามรอบ (รายสัปดาห์/2 สัปดาห์/รายเดือน)
3. **Challenge for the pool** — Float: ประมูลดอกเบี้ยสูงสุด / Discount: ส่วนลดต่ำสุด / Fix: ตามตำแหน่ง — "judge by smart contract"
4. **Withdrawal** — ผู้ชนะนำเงินกองกลางไปใช้/ลงทุน แล้วกลับไปทำข้อ 2 ต่อ
   ผู้ที่ได้รับเงินแล้ว **ประมูลไม่ได้อีก** จนกว่าทุกคนจะได้รับครบ

## 3. อภิธานศัพท์ (Glossary) — คำใน code

| คำ | ความหมาย | ที่พบ |
| --- | --- | --- |
| Peer Share Room / Group | วงแชร์ 1 วง | `PeerShareRoom` (api), `activeGroup` (smartcontract) |
| `paymentTerm` | จำนวนเงินที่สมาชิกต้องจ่ายต่องวด (ตัวเลข) | api, web |
| `paymentTermUnit` | ความถี่การจ่าย (string อิสระ เช่น `"1w"`) | api |
| `creditRequirement` | เกรดเครดิตขั้นต่ำที่เข้าห้องได้ (`A`–`F`) | api |
| `creditScore` | เกรดเครดิตของผู้ใช้ ค่าเริ่มต้น `"C"` | `User` (api) |
| `credit` constants | `A=5, B=4, C=3, D=2, E=1, F=0` | `api/constants/credit.js` |
| `currentDE` | Debt-to-Equity ratio ของผู้ใช้ (ยังไม่มีการคำนวณ) | `User` (api) |
| `bidTimeOut` | ระยะเวลาประมูล รูปแบบ `"1w 2d 3h 4m 5s"` | api (`utils/time.js`) |
| `startBidDate` | วันเริ่มประมูล | api |
| `bidRound` / `round` | รอบปัจจุบัน | api, web |
| `isBidden` / `isPaid` / `isWinner` | สถานะสมาชิกในรอบ: ประมูลแล้ว / จ่ายแล้ว / ได้เงินกองไปแล้ว | api, web |
| `bidRate` / `interest` | ดอกเบี้ยที่เสนอในการประมูล | api, web |
| `inviteCode` | รหัสเชิญ 8 ตัว (hex จาก UUID v4) | api |
| `private` / `roomPassword` | ห้องส่วนตัว ต้องใช้รหัสผ่าน (bcrypt hash) | api |
| Pool | `paymentTerm × จำนวนสมาชิก` | web |
| `groupPolicy.timeLength` | `Instant` (สำหรับ demo), `Daily`, `Weekly`, `Monthly`, `Yearly` | smartcontract |
| `collatMech` | กลไกหลักประกัน (`None`, "Social credit" ใน UI) | smartcontract, Vue |
| `underlyingAsset` / `currencyType` | สินทรัพย์ (`Cash`) / สกุลเงิน (`THB`, `Eth` ใน UI) | smartcontract, Vue |
| `readyStatus` / `groupReadyStatus` | สมาชิกกด ready / ทุกคน ready แล้ว | smartcontract |
| `isHost` | ผู้สร้างวง (สั่ง start ได้คนเดียว) | smartcontract |

## 4. ฟีเจอร์ที่วางแผนไว้ (จาก README ของ `web`)

| หน้าจอ | สถานะ |
| --- | --- |
| Sign Up / Sign In | ✅ |
| Dashboard | ✅ |
| Peer Share Room — Member List / Pool / Bidding / Payment | ✅ (UI, ข้อมูล mock) |
| Mobile Number Verification, Verification Code, Account Created | ❌ |
| Touch ID Confirmation, Set PIN | ❌ |
| Money Summary, Lending Peer Sharing Dashboard | ❌ |
| Peer Share Room — Receipt, Won Bids | ❌ |

Microfinance (ปุ่ม "micro finance" บน Dashboard) **ยังไม่มีการ implement** ทั้งฝั่ง frontend และ backend

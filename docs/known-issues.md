# Known Issues, ความเสี่ยง และข้อเสนอแนะ

[← กลับหน้าหลัก](./README.md)

รายการนี้ได้จากการอ่านโค้ด (static review) ณ commit ล่าสุดของแต่ละ repo — ยังไม่ได้รันทดสอบทุกข้อ
ระดับ: 🔴 สูง · 🟠 กลาง · 🟡 ต่ำ

## 1. `web` และ `api` ไม่ตรงกัน

| # | ระดับ | ปัญหา | ที่อยู่ | แนวทางแก้ |
| --- | --- | --- | --- | --- |
| 1.1 | 🔴 | `api` เปลี่ยน path ใน `b1cf6ba` แต่ `web` ยังเรียก path เก่า (`/auth/signin`, `/user/summary`, `/transaction/*`, `/peershare-room*`) → 404 ทุก request | `web/src/service/*` | อัปเดต path (ดู [getting-started.md](./getting-started.md#23-รัน-web)) |
| 1.2 | 🔴 | Base URL hardcode `http://10.2.150.92:5000` (IP ในวง LAN) — deploy บน Vercel แล้วเรียกไม่ได้ และเป็น HTTP บนหน้า HTTPS (mixed content) | `web/src/service/*` | ใช้ `VITE_API_URL` |
| 1.3 | 🟠 | Model ไม่ตรง: web คาด `roomType: 'public'/'private'`, `joinable`, `typeRoom: 'fixed'/'float'`, `fullName`; API ส่ง `private: boolean`, `typeRoom: 'Fix'/'Float'`, `fullname`, ไม่มี `joinable` → ทุกห้องแสดง `LOCKED` | `web/src/model/peershare-room.ts` | ให้ API คำนวณ `joinable` หรือปรับ web ให้ใช้ `private` |
| 1.4 | 🟠 | ห้อง public: web แค่ navigate ไม่ได้เรียก `POST /join` → ผู้ใช้ไม่ถูกเพิ่มเป็นสมาชิกจริง | `PeerSharingDashboard.tsx` | เรียก joinRoom ก่อน navigate |
| 1.5 | 🟠 | Validation ไม่ตรง: web อนุญาต password มีอักขระพิเศษ, phone ≥ 9 หลัก; API บังคับ alphanumeric 8–30, phone 10 ตัวพอดี, fullname ≤ 30 → error ทั่วไป `unknown error` | `libs/validations/register.ts` vs `validations/auth.validation.js` | ใช้กฎเดียวกัน และแสดง message จาก API |
| 1.6 | 🟡 | `MainDashboardSummary.microFinanceBalance` ไม่มีใน API | `model/summary.ts` | |

## API

| # | ระดับ | ปัญหา | ที่อยู่ |
| --- | --- | --- | --- |
| A1 | 🔴 | `GET /peershare-rooms` และ `GET /:id` คืน **`roomPassword` (bcrypt hash) และ `inviteCode` ของห้อง private** ให้ผู้ใช้ทุกคน — ทำให้ระบบรหัสผ่านห้องไร้ความหมาย (โค้ด map field ที่ซ่อนข้อมูลถูกลบใน `d513f5d`) | `controllers/peershare-room.controller.js` |
| A2 | 🔴 | `payForPeerShare`: ถ้าผู้ใช้มี `peerShareBalance` ของห้องอื่นอยู่แล้ว การจ่ายเข้าห้องใหม่จะ **หักเงินจาก balance แต่ไม่บันทึกยอดของห้องใหม่** (มี branch `if (isRoomExist)` แต่ไม่มี `else push`) → เงินหาย | `peershare-room.controller.js` (`payForPeerShare`) |
| A3 | 🔴 | ไม่มี atomicity: การเปลี่ยน `User` และ `PeerShareRoom` เป็น 2 `save()` แยก และ deposit/withdraw ใช้ read-modify-write → race condition (ถอนซ้อนกันอาจติดลบ) | `transaction.controller.js`, `peershare-room.controller.js` |
| A4 | 🟠 | `/pay` ไม่ตรวจว่า `amount` = `paymentTerm`, ไม่ตรวจว่าจ่ายรอบนี้แล้ว (จ่ายซ้ำได้) | |
| A5 | 🟠 | `joinRoom` บังคับ `roomPassword` แม้ห้อง public; ไม่ตรวจ `creditRequirement`; "เป็นสมาชิกอยู่แล้ว" ตอบ `400 {status:true}` | `validations/peershare.validation.js` |
| A6 | 🟠 | `getAllRooms`, `getRoomById`, `getAllMembersInRoom` ไม่มี try/catch — `:id` ผิดรูปแบบทำให้เกิด unhandled rejection (Express 4) | |
| A7 | 🟠 | `typeRoom` ไม่ถูก validate enum ใน Joi → ค่าอื่นจะได้ 500 แทน 400 | |
| A8 | 🟠 | `startBidDate` ถูกบวก 7 ชม. แบบ hardcode (timezone hack) — ควรเก็บเป็น UTC และแปลงที่ client | `createRoom` |
| A9 | 🟠 | ไม่มี bidding/round logic (ถูกลบ), `history`, `debt`, `currentDE`, `creditScore` ไม่ถูกใช้ | |
| A10 | 🟡 | Swagger: ใช้ key `securitySchemas` (ควรเป็น `securitySchemes`), ไม่มี JSDoc ในทุก route → `/docs` ว่าง; README บอกว่าเปิดเฉพาะ dev แต่จริงเปิดทุก env | `server.js` |
| A11 | 🟡 | Cookie `Max-Age=7200` ไม่ตรงกับ JWT `1d` และ cookie ไม่ถูกใช้ — ควรเลือกวิธีเดียว | `auth.controller.js` |
| A12 | 🟡 | `createRoom` ใส่ field ที่ไม่มีใน schema (`bitRate`, `totalInterest`) — สะกดผิดจาก `bidRate` | |
| A13 | 🟡 | `cors({ origin: "*" })`, ไม่มี rate-limit/helmet, ใช้ตัวแปรชื่อ `private` (reserved word ใน strict mode) | |
| A14 | 🟡 | `docs/docs.http` ล้าสมัย, `convertCredit` ไม่ถูกใช้, `NODE_ENV` ไม่ถูกใช้, ไม่มี test (`jest` ไม่มีไฟล์), มี lockfile 2 แบบ, `node:16` EOL, license ใน package.json (ISC) ≠ LICENSE (MIT) | |

## Web

| # | ระดับ | ปัญหา | ที่อยู่ |
| --- | --- | --- | --- |
| W1 | 🟠 | หน้าห้อง (`PeerShareRoom`) ใช้ mock data ทั้งหมด, ไม่ fetch ตาม `:id`; Bidding/Payment ไม่เรียก API; countdown ชี้วันที่คงที่ `2023-03-26` | `screens/PeerShareRoom.tsx` |
| W2 | 🟠 | ไม่มี route guard / ไม่จัดการ token หมดอายุ (401) | `App.tsx` |
| W3 | 🟠 | ค่า D/E, Credit Score (`SSS+`), Peer share amount ใน PeerSharingDashboard hardcode | |
| W4 | 🟡 | `Welcome` เรียก `setTimeout` ใน render และใช้ `window.location.href` (full reload) แทน `navigate` | `screens/Welcome.tsx` |
| W5 | 🟡 | ใช้ `alert()` แสดง error (มีข้อความไม่สุภาพ `alert('shit')` ใน `peer-sharing.service.tsx`), `console.log` จำนวนมาก | |
| W6 | 🟡 | List render ไม่มี `key` (`MemberList`, `ContactList`, `PoolTab`, `BidingMemberList`) | |
| W7 | 🟡 | `axios` ติดตั้งแต่ไม่ใช้, `zod` อยู่ใน devDependencies แต่ใช้ runtime, service ไฟล์เป็น `.tsx` ทั้งที่ไม่มี JSX, ส่ง `Access-Control-Allow-Origin` เป็น request header | |
| W8 | 🟡 | ปุ่ม Create Room, Save (slider), Invite friends, No ใน modal, micro finance ยังไม่มี action | |

## `bank4all-smartcontract`

| # | ระดับ | ปัญหา | ที่อยู่ |
| --- | --- | --- | --- |
| S1 | 🔴 | `const cronLOT` แล้ว assign ใหม่ → **TypeError** ทุกครั้งที่ start กลุ่มแบบ Daily/Weekly/Monthly/Yearly | `server.js` `startGroupActivity` |
| S2 | 🔴 | `/start` อ้าง `selectedUser` ที่ไม่ได้ประกาศ → ReferenceError เมื่อไม่พบกลุ่ม | `server.js` |
| S3 | 🔴 | `localQuorumNode.js` รันไม่ได้: `HOST`, `clientIP`, `sendNextQueryResultChunk` ไม่ถูกประกาศ, `const hrstart` ถูก assign ใหม่, `xml2js` ไม่อยู่ใน dependencies, path `./config/contractAddress.js` ผิด | `smartcontracts/localQuorumNode.js` |
| S4 | 🔴 | `sendToLocalNode` ส่ง `sendingPackage.toString()` = `"[object Object]"` แต่ฝั่งรับ parse เป็น XML → ไม่ทำงาน | `server.js` |
| S5 | 🟠 | เรียก `transferTHB` ด้วย `.call()` (ไม่สร้าง transaction, ไม่ emit event) ควรใช้ `.send()` | `localQuorumNode.js` |
| S6 | 🟠 | Contract ไม่มีการควบคุมสิทธิ์และไม่เก็บ state — ใครก็ emit "TransferCompleted" ปลอมได้ ไม่เหมาะเป็นหลักฐาน | `simpleTransact.sol` |
| S7 | 🟠 | `/joingroup` ไม่ตรวจรหัสผ่านห้อง private, จำนวนสมาชิก, การ join ซ้ำ; `/bid` ไม่ตรวจว่ากลุ่ม start แล้ว และ bid ซ้ำถูกนับหลายครั้ง | `server.js` |
| S8 | 🟠 | `authenticateJWT` — ถ้า token valid แต่ user ไม่มีจริง `req.user` เป็น undefined → crash ที่ handler; JWT ไม่มี expiry | |
| S9 | 🟠 | Group id = `sha1(body)` → สร้างกลุ่มด้วย body เดียวกันจะได้ id ซ้ำ | `/creategroup` |
| S10 | 🟡 | `/ready` และ `/bid` ตอบ response ก่อนประมวลผล; ข้อมูลเขียนไฟล์ JSON แบบ sync ไม่มี lock; `genMockdb.js` เขียนไฟล์ลง cwd แต่ server อ่าน `config/mockdb.json` | |
| S11 | 🟡 | `config/db.js` ใช้ mongoose ที่ไม่ได้ติดตั้ง; `becrypTest.js` ถูก commit แม้อยู่ใน `.gitignore`; รหัสผ่านบัญชีทดสอบเขียนเป็นคอมเมนต์ใน repo public | |

## `bank4all-blockathon2023Frontend`

| # | ระดับ | ปัญหา |
| --- | --- | --- |
| V1 | 🟠 | `vue-router` ไม่อยู่ใน `package.json` → `npm install && npm run serve` จะ fail |
| V2 | 🟡 | Static mockup ทั้งหมด ไม่มี API integration; รูปส่วนใหญ่โหลดจาก S3 ของ Anima (อาจหายในอนาคต) |
| V3 | 🟡 | `src.rar` (binary) ใน repo, README ไม่ตรงกับโครงสร้าง (`cd package_code`) |

## Organization-wide

| # | ระดับ | ข้อเสนอแนะ |
| --- | --- | --- |
| O1 | 🟠 | ไม่มี CI สำหรับ build/lint/test ในทุก repo — เพิ่ม GitHub Actions พื้นฐาน |
| O2 | 🟠 | ไม่มี test เลยในทุก repo |
| O3 | 🟡 | Repo `blockchain` (private) ว่างเปล่า — archive/ลบ |
| O4 | 🟡 | README ของ `bank4all` ไม่กล่าวถึง repo ฝั่ง Blockathon — เพิ่มลิงก์และอธิบาย 2 tracks |
| O5 | 🟡 | Issues #20–#31 ใน `api` (Swagger TODO) ค้างอยู่ทั้งหมด |
| O6 | 🟡 | Dependencies ทั้งหมดเป็นเวอร์ชันปี 2023 (web3 1.x deprecated → ethers/viem หรือ web3 v4) |

## ลำดับแนะนำถ้าจะพัฒนาต่อ

1. แก้ A1, A2, A3 (ความปลอดภัย/ความถูกต้องของเงิน) และ 1.1–1.2 ให้ web ใช้งานกับ api ได้
2. ออกแบบและ implement round/bidding ใน `api` (นำ logic จาก `bank4all-smartcontract` `bidStatusCheck` + โค้ดเดิม `checkForStart` มาปรับ) พร้อม transaction ledger
3. เชื่อมหน้า `PeerShareRoom` กับ API จริง
4. เพิ่ม test + CI
5. ตัดสินใจเรื่อง blockchain: ใช้เป็น audit log (เก็บ hash ของ event) แทนการถือเงินจริง จะลดความซับซ้อนด้านกฎหมาย (ดูคำถามใน Issue #21)

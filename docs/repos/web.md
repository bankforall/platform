# `web` — Frontend หลัก (React / Vite / Tailwind / TypeScript)

[← กลับหน้าหลัก](../README.md) · Repo: https://github.com/bankforall/web

| | |
| --- | --- |
| ภาษา | TypeScript (strict) |
| Framework | React 18.2 + React Router 6.9 (`createBrowserRouter`) |
| Build tool | Vite 4 (`@vitejs/plugin-react`) |
| Styling | Tailwind CSS 3 + PostCSS/Autoprefixer, ฟอนต์ DM Sans (Google Fonts) |
| Forms | react-hook-form 7 + zod 3 (`@hookform/resolvers`) |
| Charts | chart.js 4 + react-chartjs-2 5 |
| HTTP | `fetch` (มี `axios` ใน dependencies แต่ไม่ได้ใช้) |
| อื่นๆ | `jwt-decode` |
| Deploy | Vercel (`vercel.json` rewrite ทุก path → `/` สำหรับ SPA) |
| Commits | 87 (2023-03-15 → 2023-04-04) |

## 1. โครงสร้างโฟลเดอร์

```
web/
├── index.html                    # <body class="bg-[#E5E5E5]">, title "Bank For All"
├── vite.config.ts                # alias "@" → src
├── tailwind.config.cjs           # สีและฟอนต์ของแบรนด์
├── vercel.json                   # SPA rewrite
├── public/                       # SVG: bankwest, mastercard, paypal, barcode, qrcode, vite
└── src/
    ├── main.tsx                  # ReactDOM.createRoot + StrictMode
    ├── App.tsx                   # router
    ├── screens/                  # หน้าจอ (route-level)
    │   ├── Welcome.tsx           # splash → redirect /login หลัง 1.6s
    │   ├── Login.tsx
    │   ├── Register.tsx
    │   ├── Dashboard.tsx
    │   ├── PeerSharingDashboard.tsx
    │   └── PeerShareRoom.tsx     # 4 แท็บ: Member / Pool / Biding / Payment
    ├── components/
    │   ├── BaseLayout.tsx        # container max-w-sm (mobile layout)
    │   ├── Congratulation.tsx    # หน้าสำเร็จ (check icon)
    │   └── CountdownTimer.tsx    # นับถอยหลัง days/h/min/sec
    ├── modals/CommonModal.tsx    # modal มี text input + ปุ่ม yes/no
    ├── service/                  # เรียก API
    │   ├── auth.service.tsx
    │   ├── summary.service.tsx
    │   ├── account-transaction.service.tsx
    │   └── peer-sharing.service.tsx
    ├── model/                    # TypeScript interfaces
    │   ├── peershare-room.ts, register.ts, summary.ts, commonModalOption.ts
    ├── libs/validations/         # zod schemas
    │   ├── login.ts, register.ts
    └── styles/index.css          # tailwind + .scrollbar-hide + .feature-*
```

## 2. การรัน

```bash
npm install          # มีทั้ง package-lock.json และ pnpm-lock.yaml
npm run dev          # vite --host --port 3000 → http://localhost:3000
npm run build        # tsc && vite build → dist/
npm run preview
```

ไม่มี `.env` — URL ของ API **hardcode** เป็น `http://10.2.150.92:5000` ในทุกไฟล์ `src/service/*` (IP ใน LAN ช่วง hackathon)

## 3. Design tokens (Tailwind)

| Token | ค่า | ใช้กับ |
| --- | --- | --- |
| `purple` | `#1C1939` | ข้อความหัวเรื่อง |
| `grey` | `#F7F7F7` | พื้น input |
| `clay` | `#2C2948` | ข้อความ input |
| `lightpurple` | `#7165E3` | สีหลัก (ปุ่ม, header) |
| `font-sans` | DM Sans | |

พื้นหลังหน้า `#E5E5E5`, พื้น layout `#F9F9FB`, layout กว้างสูงสุด `max-w-sm` (ออกแบบสำหรับมือถือ)

## 4. Routes

| Path | Screen | ต้อง login? | ใช้ข้อมูลจริงจาก API? |
| --- | --- | --- | --- |
| `/` | `Welcome` | – | – (redirect ไป `/login` หลัง 1.6 วินาที ด้วย `window.location.href`) |
| `/login` | `Login` | – | ✅ |
| `/register` | `Register` | – | ✅ |
| `/dashboard` | `Dashboard` | ควร (ไม่มี guard) | ✅ บางส่วน |
| `/peershare-dashboard` | `PeerSharingDashboard` | ควร (ไม่มี guard) | ✅ บางส่วน |
| `/peershare-room/:id` | `PeerShareRoom` | ควร (ไม่มี guard) | ❌ mock ทั้งหมด |

ไม่มี route guard — ถ้าไม่มี token หน้าจะโหลดแต่ API จะตอบ 401

## 5. รายละเอียดแต่ละหน้าจอ

### 5.1 Login (`/login`)
- ฟอร์ม `email`, `password` validate ด้วย `loginSchema` (zod): email ถูกต้อง, password ≥ 8
- `login()` → ถ้าสำเร็จ decode JWT เก็บ `sessionStorage.userId` และ `sessionStorage.userToken` แล้ว `navigate("/dashboard")`
- ผิดพลาด → `alert('user/password incorrect')`
- "Forgot Password?" เป็นแค่ข้อความ

### 5.2 Register (`/register`)
- ฟิลด์: `fullname` (≥3), `email`, `password` (≥8), `confirmPassword` (ต้องตรงกัน), `phoneNumber` (`/^0\d{8,}$/` — ขึ้นต้น 0 อย่างน้อย 9 หลัก), `terms` (checkbox ต้องติ๊ก)
- ส่งเฉพาะ `fullname, email, password, phoneNumber` ไป API แล้วทำเหมือน login
- ⚠️ กฎไม่ตรงกับ API (API ต้องการ password alphanumeric เท่านั้น, phone ยาว 10 พอดี, fullname ≤ 30) — ถ้าไม่ผ่านจะเห็นแค่ `alert('unknown error')`

### 5.3 Dashboard (`/dashboard`)
- เรียก `getSummary()` → แสดง **Total Saving** = `balance`, การ์ด "peer sharing" = `peerShareBalance`, "micro finance" = `microFinanceBalance` (API ไม่ส่งค่านี้ → แสดง `-`)
- ปุ่ม **Add money (1000)** / **Withdraw (1000)** → `deposit(1000)` / `withdraw(1000)` แล้วอัปเดตยอดฝั่ง client
- ปุ่ม "Save for an emergency" / "Invest your money" เปิด `RangeSlider` (0–100) — ปุ่ม Save ไม่มี handler
- "Invite your friends and get a bonus" — ไม่มี action
- การ์ด peer sharing → ลิงก์ `/peershare-dashboard`; micro finance → `Link to=""` (ยังไม่มี)

### 5.4 Peer Sharing Dashboard (`/peershare-dashboard`)
- Header แสดง `Bath 0`, `Current D/E = 2`, `Credit Score = SSS+` — **ค่าคงที่ hardcode**
- เรียก `getAllRoom()` แสดงการ์ดห้องแต่ละห้อง: Room Name, Members `n / max`, Credit, Type, Payment term,
  และแถบ Pool ปัจจุบัน (`paymentTerm × members.length`) เทียบกับเต็มวง (`paymentTerm × maxMember`)
- ปุ่มต่อห้อง:
  - `JOINED` — ถ้า `members[].user` มี `sessionStorage.userId` → ไปหน้าห้อง
  - `JOIN` — ถ้า `room.roomType === 'public'` → ถ้า `room.joinable` ไปหน้าห้อง (ไม่เรียก API join) ไม่งั้น `alert('requirement not met.')`
  - `LOCKED` — ห้อง private → เปิด `CommonModal` ให้กรอก "invitation code" ซึ่งจริงๆ ถูกส่งเป็น `roomPassword` ไปที่ `POST /peershare-room/join/{room.inviteCode}`
  - disabled เมื่อห้องเต็มและยังไม่ได้เป็นสมาชิก
- ⚠️ API ไม่มี field `roomType`/`joinable` (มี `private: boolean`) → ทุกห้องที่ยังไม่ join จะแสดงเป็น `LOCKED` และปุ่มเป็นสีเทา
- ปุ่ม "Create Room" ไม่มี handler

### 5.5 Peer Share Room (`/peershare-room/:id`)

ใช้ `PeerShareRoomData` ที่ hardcode ในไฟล์ (3 สมาชิก "John Doe") — `:id` ถูก log เฉยๆ ไม่ได้ fetch

| แท็บ | เนื้อหา |
| --- | --- |
| **Member** | การ์ดสมาชิกแบบเลื่อนแนวนอน + รายการ "All contacts" พร้อมช่องค้นหา (ยังไม่ทำงาน) ปุ่ม Add/DM |
| **Pool** | Doughnut chart (ข้อมูลตัวอย่างจาก Chart.js docs: Red/Blue/Yellow…) + `Round x/maxMember` + สถานะสมาชิก `lent` (ชนะแล้ว) / `Bid-able` |
| **Biding** | ถ้ายังจ่ายไม่ครบ: แสดง `x / n members have paid` + countdown; ถ้าครบ: รายชื่อ (ไม่รวมผู้ชนะแล้ว) สถานะ `Bidden`/`waiting for bid` + ปุ่ม `Start Bid` → popup `BidingAction` ใส่จำนวนดอกเบี้ย → `alert("Confirm: x")` (มี `// TODO: call api to start bidding`) — countdown ชี้ไปที่ `2023-03-26` คงที่ |
| **Payment** | สรุป Payment term / Interest / Round / Total Interest / %ต่อปี, ปุ่มช่องทางจ่าย (Mastercard/PayPal/Bankwest — รูปเท่านั้น), barcode/QR ตัวอย่าง, ปุ่ม Confirm → หน้า `Congratulation` (ไม่เรียก API `/pay`) |

## 6. Service layer (การเรียก API)

ทุกฟังก์ชันใช้ `fetch` ส่ง header `Content-Type: application/json`, `Authorization: Bearer ${sessionStorage.userToken}`
(และส่ง `Access-Control-Allow-Origin: *` เป็น request header ซึ่งไม่มีผล)

| ฟังก์ชัน | Method + Path ที่ web เรียก | Path ปัจจุบันใน `api` | คืนค่า |
| --- | --- | --- | --- |
| `login(data)` | `POST /auth/signin` | `/auth/sign-in` ❌ | `boolean` |
| `signUp(data)` | `POST /auth/signup` | `/auth/sign-up` ❌ | `boolean` |
| `getSummary()` | `GET /user/summary` | `/users/summary` ❌ | `MainDashboardSummary` |
| `deposit(amount)` | `POST /transaction/deposit` | `/transactions/deposit` ❌ | `boolean` |
| `withdraw(amount)` | `POST /transaction/withdraw` | `/transactions/withdraw` ❌ | `boolean` |
| `getAllRoom()` | `GET /peershare-room` | `/peershare-rooms` ❌ | `PeerShareRoom[]` |
| `joinRoom(code, pw)` | `POST /peershare-room/join/:code` | `/peershare-rooms/join/:code` ❌ | `response.status` ของ body (`true`/`false`/`undefined`) |

`web` ตรงกับ `api` ณ commit ก่อน `b1cf6ba` (2023-04-04) — ดูวิธีแก้ใน [known-issues.md](../known-issues.md#1-web-และ-api-ไม่ตรงกัน)

## 7. TypeScript models

```ts
// model/peershare-room.ts
interface PeerShareRoom {
  id: string; _id: string; inviteCode?: string; roomName: string;
  maxMember: Number; payment: Number; creditRequirement: string;
  typeRoom: 'fixed' | 'float';        // API ใช้ 'Fix' | 'Float'
  paymentTerm: string;                 // API เป็น Number
  paymentTermUnit: string;
  joinable?: boolean;                  // API ไม่มี
  roomType: 'public' | 'private';      // API ใช้ private: boolean
  members: Member[]; roomPassword: string;
}
interface Member {
  user: string; role: string; isBidden: boolean; isPaid: boolean; isWinner: boolean;
  bidRate: number; fullName: string;   // API ใช้ 'fullname'
  credit: string; avatar: string; phoneNumber: string; interest: number; _id: string;
}

// model/summary.ts
interface MainDashboardSummary { balance: string; peerShareBalance: string; microFinanceBalance: string }
```

## 8. Components ที่ใช้ซ้ำได้

| Component | Props | หมายเหตุ |
| --- | --- | --- |
| `BaseLayout` | `children` | wrapper มือถือ |
| `Congratulation` | `description` | หน้า Success |
| `CountdownTimer` | `targetDate: Date` | อัปเดตทุก 1 วินาที; ซ่อนหน่วยที่เป็น 0 |
| `CommonModal` | `title, description?, yesButtonName?, noButtonName?, textInputPromptTitle?, yesButtonClickedCallback?` | ปุ่ม No ไม่มี onClick (ปิด modal ไม่ได้) |

## 9. CI/CD

เหมือน `api`: GitHub Action "Run TODO to Issue" เท่านั้น — ไม่มี build/lint/test

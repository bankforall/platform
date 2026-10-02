# `bank4all`, `.github` และ `blockchain`

[← กลับหน้าหลัก](../README.md)

## 1. `bank4all` — Repo หลักของโปรเจกต์

Repo: https://github.com/bankforall/bank4all · ⭐ 11 · 79 commits · สร้าง 2023-02-26

### เนื้อหาปัจจุบัน
มีเพียง `README.md`, `LICENSE` (MIT, Copyright 2023 ihopethisworks) และ `.gitignore`

README ประกอบด้วย:
- คำอธิบายโปรเจกต์ (Peer Share & Microfinance สำหรับคนรายได้น้อย/ว่างงาน)
- ลิงก์ **Business Plan & Pitch Deck** (Canva)
- Tech stack: React, Tailwind CSS, TypeScript / Node.js, Express, MongoDB, Mongoose
- ลิงก์ไปยัง repo [`web`](https://github.com/bankforall/web) และ [`api`](https://github.com/bankforall/api)
- Contribution guidelines (รายงาน Issue, ส่ง PR, ปรับปรุงเอกสาร)

### ประวัติ: จาก monorepo สู่หลาย repo

ก่อน 2023-03-15 repo นี้เป็น **monorepo** ที่ทดลองหลาย stack:

| โฟลเดอร์ (ถูกลบแล้ว) | เนื้อหา |
| --- | --- |
| `backend/` | `nodeServer.js` (Express), `Models/index.js` (Mongoose: `User`, `PeerShareDetails`), `middleware/auth.js` (JWT), `docker-compose.yml` (MongoDB), `docs.http`, README spec API (`/signIn`, `/signUp`, `/balanceSummary`, ...) |
| `backend/unusedYetFiles/bank.sol` | ร่าง Solidity `Crowdfunding` (join/lend/withdraw ดอกเบี้ย 5%) — คอมเมนต์ระบุว่าร่างด้วย ChatGPT |
| `front-end/` | Angular (login, dashboard, auth.service) |
| `my-app/` | Create React App (Header, LoginPage, UserDashboardPage) |

ลำดับการแยก:
1. `61be1b5` / `3d695d6` — เพิ่ม git submodule `bankForAllBackEnd`, `bankForAllFrontEnd`
2. `1271594` "move to each repo" — ลบโค้ดทั้งหมด (~38,000 บรรทัด)
3. `95b7be6` "remove submodule" — เหลือแค่ README

ดูโค้ดเก่าได้ด้วย: `git show 1271594^:backend/nodeServer.js`

### GitHub Issues (ใช้เป็นที่วางแผนโปรเจกต์)

| # | หัวข้อ | สถานะ | สรุป |
| --- | --- | --- | --- |
| 3 | Test Issue! | closed | |
| 4 | Peer Sharing | open | checklist: fetch rooms ✅, join rooms, room summary page |
| 5 | fetch list of peer sharing rooms | closed | |
| 9 | Someone please guide me about how to use docker | closed | |
| 11 | Road from Problem Identification to MVP | open | สรุป Hack Day: pain point, เทียบ LINE/FB Group, ประเด็นกฎหมาย (ธปท./ก.ล.ต.), กลุ่มเป้าหมาย, Digital ID — ดู [domain-and-product.md](../domain-and-product.md) |
| 13 | Project MVP Main Flowchart | open | ภาพ flowchart MVP + checklist ออกแบบ (User JSON, Group JSON, policy enforcer/timer, payment, registration, auth) |
| 17 | automatically update submodules | closed | |
| 21 | Pending Research Tasks | open | รายการคำถามวิจัย (กฎหมาย, UX, การประเมินเครดิต, currency, tie-break การประมูล, on-chain vs off-chain) |

## 2. `.github` — Organization profile

Repo: https://github.com/bankforall/.github · ไฟล์เดียว `profile/README.md`

แสดงบนหน้า org: ชื่อ "Bank For All - Peer Share and Microfinance Platform for All", Discord badge
(https://discord.gg/QK2gtrduGc), คำอธิบายโปรเจกต์ และ Contribution Guidelines

## 3. `blockchain` — (Private)

- สร้าง 2023-04-03, 1 commit "Initial commit"
- มีเพียงไฟล์ `LICENSE` (MIT, Copyright 2023 Bank For All)
- น่าจะเตรียมไว้สำหรับงาน blockchain แต่สุดท้ายงานจริงไปอยู่ที่ `bank4all-smartcontract`
- ข้อเสนอแนะ: archive หรือลบ เพื่อลดความสับสน

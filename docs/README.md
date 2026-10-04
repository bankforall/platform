# Bank For All — เอกสารรวมทุก Repository

> เอกสารชุดนี้จัดทำจากการอ่านโค้ด, git history, README และ GitHub Issues ของทุก repository ใน organization
> [`github.com/bankforall`](https://github.com/bankforall) ณ วันที่ **2 ตุลาคม 2026**
> (โค้ดส่วนใหญ่หยุดพัฒนาตั้งแต่เมษายน–พฤษภาคม 2023)

## Bank For All คืออะไร

**Bank For All (Bank4All)** เป็นโปรเจกต์ open-source ที่ต้องการสร้างแพลตฟอร์ม **Peer Share (เปียแชร์ / วงแชร์ / ROSCA)**
และ **Microfinance** สำหรับคนว่างงาน คนรายได้น้อย หรือกลุ่มที่เข้าไม่ถึงบริการทางการเงินของธนาคาร
ให้สามารถออมเงิน กู้ยืม และแบ่งปันทรัพยากรกันได้อย่างโปร่งใส โดยใช้ "ระบบ" เป็นตัวกลางแทน "ท้าวแชร์"

โปรเจกต์เริ่มเมื่อ 26 ก.พ. 2023 ถูกพัฒนาหนักช่วง hackathon ที่กรุงเทพฯ (25–26 มี.ค. 2023 ตาม git history)
และต่อยอดเป็นเวอร์ชัน blockchain สำหรับงาน **SCB Bangkok Blockathon 2023** (1–5 พ.ค. 2023)

## สารบัญเอกสาร

| ไฟล์ | เนื้อหา |
| --- | --- |
| [architecture.md](./architecture.md) | ภาพรวมสถาปัตยกรรม, ความสัมพันธ์ระหว่าง repo, ไทม์ไลน์, ผู้ร่วมพัฒนา |
| [domain-and-product.md](./domain-and-product.md) | แนวคิดเปียแชร์ (ROSCA) ประเภท Fix/Float/Discount, คำศัพท์, งานวิจัยผลิตภัณฑ์จาก Issues |
| [getting-started.md](./getting-started.md) | วิธีรันระบบในเครื่อง (API + Web + MongoDB) และ smart-contract prototype |
| [repos/api.md](./repos/api.md) | Backend หลัก (Node.js/Express/MongoDB) — โครงสร้าง, data model, API reference ครบทุก endpoint |
| [repos/web.md](./repos/web.md) | Frontend หลัก (React/Vite/Tailwind/TypeScript) — หน้าจอ, service, การเชื่อม API |
| [repos/bank4all-smartcontract.md](./repos/bank4all-smartcontract.md) | Backend สำหรับ Blockathon + Solidity contract + Quorum node bridge |
| [repos/bank4all-blockathon2023Frontend.md](./repos/bank4all-blockathon2023Frontend.md) | Frontend Vue 2 ที่ generate จาก Figma (Anima) สำหรับ Blockathon |
| [repos/bank4all.md](./repos/bank4all.md) | Repo หลัก/landing (README, ประวัติ monorepo เดิม), `.github` profile และ `blockchain` (private) |
| [v2/README.md](./v2/README.md) | **ออกแบบระบบใหม่ (v2)** — การตัดสินใจ, กติกา, สถาปัตยกรรม, smart contract, กฎหมาย |
| [legal/README.md](./legal/README.md) | **ร่าง** ข้อกำหนดการใช้บริการและนโยบายความเป็นส่วนตัว (PDPA) ที่แสดงในแอป — ต้องให้นักกฎหมายตรวจก่อนใช้งานจริง |
| [known-issues.md](./known-issues.md) | รวมบั๊ก ช่องโหว่ด้านความปลอดภัย จุดที่ไม่สอดคล้องกัน และข้อเสนอแนะ เรียงตามความสำคัญ |

## สรุป Repository ทั้งหมด (7 repos)

| Repository | ภาษา / Stack | สถานะ | อัปเดตโค้ดล่าสุด | หน้าที่ |
| --- | --- | --- | --- | --- |
| [`bank4all`](https://github.com/bankforall/bank4all) | Markdown | Public | 2023-03-26 | Repo หลัก: README, ลิงก์ pitch deck, Issues วางแผนโปรเจกต์ (เดิมเคยเป็น monorepo) |
| [`api`](https://github.com/bankforall/api) | JavaScript — Node.js, Express 4, MongoDB/Mongoose 7, Passport-JWT, Joi, Swagger | Public | 2023-04-04 | REST API: auth, user, deposit/withdraw, peer-share room |
| [`web`](https://github.com/bankforall/web) | TypeScript — React 18, Vite 4, Tailwind 3, React Router 6, react-hook-form + zod, Chart.js | Public | 2023-04-04 | Web app (mobile-first) ฝั่งผู้ใช้ |
| [`bank4all-smartcontract`](https://github.com/bankforall/bank4all-smartcontract) | JavaScript — Express, web3.js 1.x, node-cron, Solidity 0.8 | Public | 2023-05-05 | Backend ROSCA แบบ mock JSON DB + bridge ไป Quorum node (Blockathon) |
| [`bank4all-blockathon2023Frontend`](https://github.com/bankforall/bank4all-blockathon2023Frontend) | Vue 2 (Anima export) | Public | 2023-05-05 | UI prototype สำหรับ Blockathon (static, ยังไม่ต่อ API) |
| [`.github`](https://github.com/bankforall/.github) | Markdown | Public | 2023-05-16 | Organization profile README |
| `blockchain` | — | **Private** | 2023-04-03 | มีเพียง `LICENSE` (MIT) — ยังไม่มีโค้ด |

## สรุปสั้นสำหรับคนที่จะพัฒนาต่อ

1. **ระบบที่ทำงานได้จริงที่สุด** คือคู่ `api` + `web` — สมัคร/ล็อกอิน, ฝาก/ถอน (จำลอง), ดูรายการห้องแชร์, เข้าร่วมห้อง private
2. **`web` ไม่สามารถคุยกับ `api` เวอร์ชันล่าสุดได้ทันที** เพราะ `api` เปลี่ยน path (`/auth/signin` → `/auth/sign-in`, `/user` → `/users` ฯลฯ) ใน commit `b1cf6ba` (2023-04-04) และ `web` ยัง hardcode IP `http://10.2.150.92:5000` — ดู [known-issues.md](./known-issues.md#1-web-และ-api-ไม่ตรงกัน)
3. **หน้าห้องแชร์ (Member / Pool / Bidding / Payment) ใน `web` ใช้ข้อมูล mock ทั้งหมด** และ backend ยังไม่มี logic การประมูล (bidding) — ถูกลบออกใน commit `d513f5d`
4. **Logic การประมูล/หาผู้ชนะแต่ละรอบ** มีอยู่เฉพาะใน `bank4all-smartcontract/server.js` (แบบ mock JSON) และ smart contract ปัจจุบันเป็นเพียงตัว emit event ไม่ได้ถือเงินจริง
5. ทุก repo ใช้ **MIT License** (ยกเว้น `package.json` ของ `api`/`smartcontract` ที่ระบุ `ISC` — ไม่สอดคล้องกัน)

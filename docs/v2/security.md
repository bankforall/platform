# Security — Bank For All v2

[← v2](./README.md) · รายงานช่องโหว่: [SECURITY.md](../../SECURITY.md)

## 1. Security model (หลักการ)

| หลักการ | ทำอย่างไร |
| --- | --- |
| **ระบบไม่ถือเงิน** | contract ไม่มีฟังก์ชัน `payable` — บันทึกได้แค่ภาระ การชำระ และหลักฐาน เงินโอนตรงระหว่างสมาชิกผ่าน PromptPay |
| **ผู้ใช้ลงนามเอง** | กุญแจสร้างในเครื่องผู้ใช้ เก็บเข้ารหัสด้วย WebCrypto แบบดึงออกไม่ได้; server ทำได้แค่ส่งต่อ (ERC-2771 relayer) |
| **ไม่เชื่อ server แบบตาบอด** | PWA ถอดรหัส calldata เอง ตรวจ chain/forwarder/factory ที่ฝังไว้ตอน build และตรวจ `to` กับวงที่ผู้ใช้กำลังทำรายการ ก่อนจะยอมลงนาม — หน้ายืนยันสร้างจากข้อมูลที่ถอดรหัสได้ ไม่ใช่ข้อความจาก server |
| **แยกกุญแจตามหน้าที่** | relayer อยู่ใน `api` เท่านั้น, keeper อยู่ใน `worker` เท่านั้น, attester อยู่ใน `signer` ซึ่งไม่เปิดพอร์ตออกนอก ต้องใช้ token และตรวจนโยบายกับฐานข้อมูลก่อนลงนามทุกครั้ง; config ไม่ยอมเริ่มถ้ามีกุญแจเกินหน้าที่ |
| **การกู้บัญชีต้องหลายคน** | ผู้ใช้พิสูจน์ความเป็นเจ้าของกุญแจใหม่ → ผู้ดูแล 2 คนที่ต่างกันอนุมัติ → รอ 24 ชม. (ผู้ใช้ยกเลิกได้และได้รับแจ้งเตือน) → worker เปลี่ยนกุญแจบน chain; ทุกขั้นบันทึกใน `AdminAuditLog` |
| **ผู้ดูแลใช้ 2 ปัจจัย** | LINE login + **พาสคีย์ (WebAuthn)** ของผู้ดูแล: ทุกรายการที่เปลี่ยนแปลงข้อมูลต้องยืนยันพาสคีย์ใหม่ภายใน `ADMIN_STEPUP_TTL` (ดู §4) — บัญชี LINE ของผู้ดูแลถูกยึดก็ยังอนุมัติอะไรไม่ได้ |
| **ข้อมูลส่วนบุคคล** | ไม่มีบน chain; ไฟล์ KYC/สลิปเข้ารหัส AES-256-GCM; เลขบัตรเก็บเป็น HMAC; backup เข้ารหัส |
| **Supply chain** | pnpm `minimumReleaseAge` 24 ชม., GitHub Actions pin ด้วย commit SHA, Dependabot, CodeQL, Slither, images มี SBOM + provenance attestation |

## 2. Pre-launch security review (2026-10-04)

ตรวจทั้ง contracts, API, web และ infrastructure (ไม่พบระดับ Critical) แก้ทุกข้อในระดับ High/Medium แล้ว
ข้อที่ยืนยันได้ด้วย test ถูกเพิ่มเป็น regression test (`packages/contracts/test/Hardening.t.sol`, API/browser end-to-end)

| # | ระดับ | ปัญหา | การแก้ไข |
| --- | --- | --- | --- |
| H1 | High | เปลี่ยนกุญแจระหว่างประมูล: ซองของกุญแจเก่ายังเปิดได้ → address ที่ถูกลบชนะ, รอบปิดไม่ได้, indexer หยุด | `rotateMember` ลบซองที่ยังไม่เปิดของกุญแจเก่า, `revealBid` ต้องเป็นสมาชิกปัจจุบัน, ลบ bid secret ฝั่ง server, ingest ทนต่อสถานะหลังเปลี่ยนกุญแจ |
| H2 | High | ผู้รับเงินที่เงียบทำให้ผู้จ่ายที่จ่ายจริงถูกบันทึกผิดนัด | ผิดนัดได้เฉพาะผู้ที่ **ไม่ได้แจ้งโอน**; ผู้รับปฏิเสธได้ภายใน `deadline + 2×grace`; เกินจากนั้นถือว่ารับแล้ว (`acceptDeclared`); สลิปที่ธนาคารยืนยันแล้ว (`Attested`) นับว่าชำระแล้วและปฏิเสธไม่ได้ |
| H3 | High | ผู้ดูแลคนเดียวเปลี่ยนกุญแจของใครก็ได้ | คำขอต้องมาจากผู้ใช้พร้อมลายเซ็นกุญแจใหม่ + ผู้ดูแล 2 คน + รอ 24 ชม. + แจ้งเตือน + audit log; signer ตรวจซ้ำทุกเงื่อนไข |
| M1 | Medium | เปลี่ยน PromptPay ได้ตลอด (เปลี่ยนปลายทางเงินกลางรอบ) | ต้องยืนยัน OTP ใหม่, ห้ามเปลี่ยนระหว่างเป็นผู้รับของรอบที่ยังไม่ปิด, แจ้งเตือนผู้ใช้ |
| M2 | Medium | web ลงนามข้อมูลที่ server ส่งมาโดยไม่ตรวจ | ตรวจ domain/chain/contract ที่ pin ไว้, ถอดรหัส calldata, ตรวจ argument กับสิ่งที่ผู้ใช้กรอก, ปฏิเสธฟังก์ชันที่ไม่รู้จัก |
| M3 | Medium | ใช้ gas ของ relayer ได้ไม่จำกัด | lock ต่อผู้ใช้ระหว่างส่ง, simulate กับ pending block, จำกัด 100 รายการ/วัน, dispute ได้ 1 ครั้งต่อรอบ |
| M4 | Medium | เลี่ยง rate limit ด้วย cookie ปลอม | key ของ rate limit ใช้ session ที่ verify แล้วเท่านั้น ไม่งั้นใช้ IP |
| M5 | Medium | กุญแจทั้งหมดอยู่ใน process ที่เปิดสู่อินเทอร์เน็ต | แยก `signer` service; env ต่อ container เฉพาะที่จำเป็น; config บังคับ least privilege |
| M6 | Medium | event เดียวที่ apply ไม่ได้หยุด indexer ทั้งระบบ | แยก error ต่อ event, บันทึก `IngestError`, แจ้งเตือน, indexer เดินต่อ |
| L1–L15 | Low | เช่น logout ไม่เพิกถอน session, นับ OTP ไม่ atomic, ตรวจชนิดไฟล์จาก MIME, wallet ไม่พิสูจน์ความเป็นเจ้าของ, health endpoint ไม่ cache, migrate image, CI ไม่ pin, backup ไม่เข้ารหัส | แก้แล้วทั้งหมด ยกเว้นที่ระบุใน §3 |

Static analysis (Slither, ไม่รวม detector ที่ยอมรับใน `slither.config.json`): **0 findings**

## 3. ความเสี่ยงที่ยอมรับและยังต้องทำ

| ประเด็น | สถานะ |
| --- | --- |
| Attestation ไม่มี nonce/เพิกถอนรายตัวไม่ได้ (L2) | อายุ 30 นาที; เพิกถอนทั้งหมดได้โดยถอด `ATTESTER_ROLE` |
| ผู้เสนอเท่ากันตัดสินด้วยลำดับยื่นซองซึ่ง relayer เห็น (L3) | ยอมรับ; server เห็นจำนวนประมูลก่อนเปิดซอง (จำเป็นสำหรับเปิดซองอัตโนมัติ) — เปิดเผยในเอกสารนี้ |
| วงที่ถูกทิ้ง (L4) | วงที่ยังไม่เริ่มยกเลิกได้โดยใครก็ได้หลัง 30 วัน (worker ทำให้); วงที่เริ่มแล้วเดินต่อเองจนจบ — การเลิกวงกลางคันยังไม่รองรับ ([D4](./decisions.md)) |
| Reorg หลังบันทึกจาก receipt ทันที (L10) | ความเสี่ยงต่ำบน Base; indexer ใช้ `CONFIRMATIONS` |
| XSS = ใช้กุญแจในเครื่องได้ (L11) | CSP เข้มงวด, ไม่มี HTML จากผู้ใช้; ข้อจำกัดของกุญแจในเบราว์เซอร์ |
| Factory admin เป็น EOA (L15) | **ต้องย้ายไป multisig (Safe) ก่อนขึ้น mainnet** |
| ผู้ดูแลที่ยังไม่ลงทะเบียนพาสคีย์ (bootstrap) | ผู้ที่ยึดบัญชี LINE ของผู้ดูแลได้ **ก่อน** ผู้ดูแลลงทะเบียนพาสคีย์แรก จะลงทะเบียนพาสคีย์ของตัวเองได้ (ภายใน 15 นาทีหลัง login) — ลดความเสี่ยงโดยให้ผู้ดูแลลงทะเบียนทันทีหลัง `promote-admin`, แจ้งเตือนทุกครั้งที่เพิ่ม/ลบพาสคีย์, บันทึก `AdminAuditLog`; การกู้บัญชียังต้องผู้ดูแล 2 คน + timelock |
| เมนูอ่านอย่างเดียวของผู้ดูแลไม่ต้อง step-up | รายการ KYC, รูปบัตร (บันทึก `kyc.view` ทุกครั้ง) และคำขอเปลี่ยนกุญแจ ต้องมีพาสคีย์ที่ลงทะเบียนแล้วแต่ไม่ต้องยืนยันซ้ำ; สลิป/วงส่วนตัวที่ผู้ดูแลเปิดดูได้ใช้สิทธิ์ role อย่างเดียว — ยอมรับเพราะไม่เปลี่ยนแปลงข้อมูล |
| Audit ภายนอก | **จำเป็นก่อน mainnet** — รีวิวนี้เป็นการตรวจภายใน |

## 4. พาสคีย์ผู้ดูแล (WebAuthn 2FA)

การเข้าสู่ระบบด้วย LINE อย่างเดียวไม่พอสำหรับอำนาจผู้ดูแล (อนุมัติ KYC, ตั้งคะแนนเริ่มต้น, อนุมัติการเปลี่ยนกุญแจ)
จึงเพิ่มปัจจัยที่สองเป็นพาสคีย์ (WebAuthn, `@simplewebauthn/server` + `@simplewebauthn/browser`) ซึ่งผูกกับโดเมน (กันฟิชชิง) และต้องยืนยันตัวผู้ใช้ (`userVerification: required` — สแกนนิ้ว/ใบหน้า/PIN ของเครื่อง)

| เรื่อง | กติกา |
| --- | --- |
| route ที่เปลี่ยนแปลงข้อมูล (`POST /api/admin/kyc/:id/decision`, `POST /api/admin/key-rotations/:id/approve`, `.../reject`, `DELETE /api/admin/passkeys/:id`) | ต้อง **step-up**: ยืนยันพาสคีย์สำเร็จภายใน `ADMIN_STEPUP_TTL` วินาที (ค่าเริ่ม 900 = 15 นาที) ใน session นี้ — ไม่งั้นได้ `403 ADMIN_STEP_UP_REQUIRED` แล้ว PWA จะขอพาสคีย์และส่งรายการเดิมซ้ำให้ |
| route อ่านอย่างเดียว (`GET /api/admin/kyc`, `GET /api/admin/kyc/:id/:file`, `GET /api/admin/key-rotations`) | ต้องมีพาสคีย์ที่ลงทะเบียนแล้ว ไม่งั้นได้ `403 ADMIN_PASSKEY_REQUIRED` (ไม่ต้อง step-up) |
| สถานะ step-up | เก็บใน Redis `admin:stepup:<sha256(session token)>` พร้อม TTL — ผูกกับ login นั้น (เครื่อง/cookie อื่นของผู้ดูแลคนเดียวกันต้องยืนยันเอง) และหมดไปเมื่อ logout (`sessionVersion` เปลี่ยน) |
| challenge | สุ่มโดย server เก็บใน Redis ผูกกับ session อายุ 5 นาที ใช้ได้ครั้งเดียว (`GETDEL`) — ส่ง assertion เดิมซ้ำจะได้ `WEBAUTHN_CHALLENGE_EXPIRED` |
| พาสคีย์แรก (bootstrap) | ลงทะเบียนได้เฉพาะภายใน **15 นาทีหลังเข้าสู่ระบบ** (ดูจาก `iat` ของ session) ไม่งั้นได้ `ADMIN_REAUTH_REQUIRED`; การลงทะเบียนนับเป็น step-up |
| พาสคีย์ถัดไป | ต้อง step-up ด้วยพาสคีย์เดิมก่อน; ควรมีอย่างน้อย 2 อุปกรณ์ |
| ลบพาสคีย์ | ต้อง step-up; ลบอันสุดท้ายไม่ได้ (`ADMIN_LAST_PASSKEY`) ขณะที่ `ADMIN_PASSKEY_REQUIRED=true` |
| counter | เก็บ signature counter และปฏิเสธถ้าถอยหลัง (ตรวจจับ authenticator ที่ถูก clone) |
| ทำอุปกรณ์หายทั้งหมด | ผู้ดูแลระบบ (เข้าถึงเซิร์ฟเวอร์) รัน `cli/clear-admin-passkeys.js <userId> "<เหตุผล>"` หลังยืนยันตัวตนนอกระบบ → ลบพาสคีย์ทั้งหมด, เพิกถอนทุก session, บันทึก `admin.passkeys.cleared` ใน `AdminAuditLog` |
| audit | `admin.passkey.register`, `admin.passkey.delete`, `admin.stepup`, `admin.stepup.failed`, `admin.passkeys.cleared` ใน `AdminAuditLog` และแจ้งเตือนผู้ดูแลทุกครั้งที่เพิ่ม/ลบพาสคีย์ |
| development/test | `ADMIN_PASSKEY_REQUIRED` ค่าเริ่มเป็น `false` นอก production: ผู้ดูแลที่ยังไม่มีพาสคีย์ทำรายการได้ (ใช้ใน e2e) แต่เมื่อลงทะเบียนแล้วจะใช้กติกาเดียวกับ production; production ไม่ยอมเริ่มถ้าตั้งเป็น `false` หรือไม่ได้ตั้ง `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` |

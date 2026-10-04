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
| วงที่ถูกทิ้งหลังเริ่มปิดไม่ได้ (L4) | ต้องออกแบบกระบวนการยุติวง (เรื่องกฎหมายด้วย) |
| Reorg หลังบันทึกจาก receipt ทันที (L10) | ความเสี่ยงต่ำบน Base; indexer ใช้ `CONFIRMATIONS` |
| XSS = ใช้กุญแจในเครื่องได้ (L11) | CSP เข้มงวด, ไม่มี HTML จากผู้ใช้; ข้อจำกัดของกุญแจในเบราว์เซอร์ |
| Factory admin เป็น EOA (L15) | **ต้องย้ายไป multisig (Safe) ก่อนขึ้น mainnet** |
| Admin ใช้ LINE login อย่างเดียว | ลดความเสี่ยงด้วย 2-person rule + timelock; ควรเพิ่ม WebAuthn สำหรับ admin |
| Audit ภายนอก | **จำเป็นก่อน mainnet** — รีวิวนี้เป็นการตรวจภายใน |

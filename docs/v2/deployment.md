# Deployment & Operations Runbook

[← v2](./README.md)

ติดตั้งบน VPS เครื่องเดียวด้วย Docker Compose: Caddy 2.11 (HTTPS อัตโนมัติ) + API/worker (Node 24 LTS) + PostgreSQL 18 + Redis 8 + SeaweedFS (S3)
โดยใช้ smart contract บน **Base** (ทดสอบบน Base Sepolia ก่อน)

```
Internet ──443──▶ web (Caddy: PWA + /api proxy, TLS) ──▶ api:4000 ──▶ postgres / redis / s3 (SeaweedFS)
                                                        worker ─────▶ (same) + Base RPC
```

## 0. สิ่งที่ต้องมีก่อน (ทำครั้งเดียว)

| รายการ | ใช้ทำอะไร | หมายเหตุ |
| --- | --- | --- |
| VPS 2 vCPU / 4 GB RAM / 40 GB SSD ขึ้นไป, Ubuntu 24.04, Docker 25+ | รันทั้งระบบ | ควรเลือก data center ในไทยหรือสิงคโปร์ (PDPA) |
| Domain + DNS A record ชี้มาที่ VPS | HTTPS | พอร์ต 80/443 ต้องเปิดจากอินเทอร์เน็ต |
| LINE Developers: **LINE Login channel** | เข้าสู่ระบบ | ตั้ง Callback URL = `https://<domain>/api/auth/line/callback` |
| LINE **Messaging API channel** (Official Account) | แจ้งเตือน | เชื่อมกับ Login channel ("Linked OA") เพื่อให้ `bot_prompt` ชวนเพิ่มเพื่อนได้ |
| SMS provider (Twilio หรือเพิ่ม adapter ผู้ให้บริการไทยใน `apps/api/src/providers/sms.ts`) | OTP | |
| RPC ของ Base (เช่น Alchemy/QuickNode) | อ่าน/เขียน chain | public RPC ใช้ทดสอบได้แต่มี rate limit |
| กุญแจ 4 ชุด (ข้อ 1) | deploy, relayer, keeper, attester | |

> **Object storage:** ใช้ SeaweedFS (Apache-2.0) แทน MinIO ซึ่งเลิกพัฒนา (repo archived และ image ถูกลบจาก Docker Hub แล้ว)
> จะใช้ S3 แบบ managed (เช่น AWS S3 ap-southeast-1, Cloudflare R2) แทนก็ได้ โดยตั้ง `S3_ENDPOINT`/keys แล้วลบ service `s3` ออก
>
> **PostgreSQL 18** เก็บข้อมูลที่ `/var/lib/postgresql` (ต่างจากเวอร์ชันก่อน) — ถ้าย้ายจากฐานข้อมูลเดิมให้ใช้ `pg_dump`/`pg_restore` ตาม `backup.sh`

## 1. กุญแจ (keys)

| กุญแจ | หน้าที่ | เก็บที่ | ต้องมี ETH |
| --- | --- | --- | --- |
| **Admin** | `DEFAULT_ADMIN_ROLE` ของ factory (pause, setCaps, จัดการ role) | **hardware wallet / multisig (Safe)** — ห้ามอยู่บนเซิร์ฟเวอร์ | เล็กน้อย |
| **Attester** | ลงนามรับรอง KYC, key rotation, `attestSlip` | container `signer` เท่านั้น (ไม่เปิดพอร์ตออกนอก, ตรวจนโยบายกับ DB ก่อนลงนาม) | ~0.005 ETH |
| **Relayer** | ส่ง transaction แทนผู้ใช้ (จ่าย gas) | container `api` เท่านั้น | ~0.02 ETH |
| **Keeper** | เดินวงตามเวลา (เปิดซอง, ปิดประมูล, ผิดนัด, ยอมรับแจ้งโอนที่ผู้รับไม่ตอบ, รอบถัดไป, เปลี่ยนกุญแจที่อนุมัติแล้ว) | container `worker` เท่านั้น | ~0.01 ETH |

```bash
cast wallet new            # สร้างกุญแจ (Foundry) — ทำบนเครื่องที่ปลอดภัย
```

- ทั้ง 3 hot keys **ต้องต่างกัน** และแต่ละ container ได้รับ **เฉพาะกุญแจของตัวเอง** (`docker-compose.prod.yml` ส่ง env แยกรายบริการ; ระบบไม่ยอมเริ่มถ้ามีกุญแจเกินหน้าที่)
- worker เตือนใน log และ `/api/health` (`gasLow: true`) เมื่อยอดต่ำกว่า `MIN_GAS_BALANCE_WEI`
- ถ้า attester key หลุด: ใช้ admin `revokeRole(ATTESTER_ROLE, old)` + `grantRole(ATTESTER_ROLE, new)` แล้วเปลี่ยนใน env

## 2. Deploy smart contracts

```bash
cd platform/packages/contracts
forge test                                    # ต้องผ่านทั้งหมด
# Base Sepolia (ทดสอบ)
ADMIN=<admin address> ATTESTER=<attester address> \
forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org \
  --account deployer --broadcast --verify --etherscan-api-key $BASESCAN_KEY
# ผลลัพธ์อยู่ที่ deployments/84532.json → นำ factory, forwarder, blockNumber ไปใส่ใน .env.production
```

สำหรับ mainnet ใช้ `--rpc-url https://mainnet.base.org` (chain 8453) **หลังผ่าน security audit ภายนอกแล้วเท่านั้น**

## 3. ติดตั้งบนเซิร์ฟเวอร์

```bash
git clone <repo> /opt/bankforall && cd /opt/bankforall/platform/deploy
cp .env.production.example .env.production && chmod 600 .env.production
$EDITOR .env.production                       # ใส่ค่าให้ครบ (ดูคำอธิบายในไฟล์)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
# หรือใช้ image ที่ release แล้ว (ดู "Release" ด้านล่าง): ตั้ง IMAGE_TAG=1.2.3 แล้ว `... pull && ... up -d`
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl https://<domain>/api/health              # {"ok":true,...,"worker":true,"gasLow":false}
```

> ⚠️ รัน `docker compose` จาก shell ที่ **ไม่มี** ตัวแปรชื่อเดียวกันค้างอยู่ — ตัวแปรใน shell มีลำดับสูงกว่า `--env-file`
> (เจอจริงตอนทดสอบ: storage ได้รหัสผ่านคนละค่ากับ API) ถ้าไม่แน่ใจให้ใช้ `env -i PATH=$PATH HOME=$HOME docker compose ...`

- `migrate` รัน `prisma migrate deploy` อัตโนมัติก่อน api/worker ทุกครั้งที่ `up`
- **ห้าม** ตั้ง `DEV_LOGIN=true` ใน production (ระบบไม่ยอมเริ่ม)
- ระบบปฏิเสธการเริ่มถ้าไม่มี LINE Login, ใช้ SMS แบบ console หรือ `PUBLIC_URL` ไม่ใช่ https
- พาสคีย์ผู้ดูแล (2FA, [security.md §4](./security.md#4-พาสคีย์ผู้ดูแล-webauthn-2fa)) บังคับเสมอใน production — ต้องตั้ง:

| ตัวแปร | ค่า | หมายเหตุ |
| --- | --- | --- |
| `WEBAUTHN_RP_ID` | hostname ที่ผู้ดูแลเปิด เช่น `app.example.co.th` (= `DOMAIN`) | **ห้ามเปลี่ยนภายหลัง** — พาสคีย์ผูกกับค่านี้ เปลี่ยนแล้วพาสคีย์ทุกอันใช้ไม่ได้ (ต้องล้างด้วย CLI และลงทะเบียนใหม่) |
| `WEBAUTHN_ORIGIN` | `https://app.example.co.th` (= `PUBLIC_URL` ไม่มี path) | ต้องเป็น https และ hostname ต้องตรงหรือเป็น subdomain ของ `WEBAUTHN_RP_ID` |
| `ADMIN_STEPUP_TTL` | `900` (วินาที, 60–3600) | ยืนยันพาสคีย์หนึ่งครั้งทำรายการผู้ดูแลต่อได้นานเท่านี้ |
| `ADMIN_PASSKEY_REQUIRED` | `true` (compose ตั้งให้แล้ว) | ตั้ง `false` ได้เฉพาะ development/test |

  นอก production ค่าเหล่านี้ได้มาจาก `PUBLIC_URL` อัตโนมัติ (`http://localhost:5173` → RP ID `localhost`) และ `ADMIN_PASSKEY_REQUIRED=false`

### ตั้งผู้ดูแล (admin) คนแรก

1. ผู้ดูแลเข้าสู่ระบบด้วย LINE หนึ่งครั้ง
2. `docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/cli/promote-admin.js <userId หรือ LINE userId>`
3. ผู้ดูแลออกจากระบบแล้วเข้าใหม่ → เมนู `/admin` → ส่วน **"ความปลอดภัยผู้ดูแล"** → ตั้งชื่ออุปกรณ์แล้วกด "เพิ่มพาสคีย์"
   **ภายใน 15 นาทีหลังเข้าสู่ระบบ** (ถ้าเลยเวลา ให้ออกจากระบบแล้วเข้าใหม่) — ก่อนลงทะเบียน เมนูผู้ดูแลใช้ไม่ได้ (`ADMIN_PASSKEY_REQUIRED`)
   ทำทันทีหลังข้อ 2 เพราะก่อนมีพาสคีย์ บัญชีผู้ดูแลยังป้องกันด้วย LINE อย่างเดียว
4. เพิ่มพาสคีย์อันที่ 2 (อีกเครื่องหรือ security key) เผื่อเครื่องหาย — ต้องยืนยันด้วยพาสคีย์แรกก่อน
5. ใช้งาน `/admin` ได้ (ตรวจ KYC, อนุมัติคำขอเปลี่ยนกุญแจ) — ทุกครั้งที่อนุมัติ/ปฏิเสธ ระบบจะขอพาสคีย์ถ้ายืนยันครั้งล่าสุดเกิน `ADMIN_STEPUP_TTL`
6. ตั้งผู้ดูแล **อย่างน้อย 2 คน** — การกู้บัญชีต้องให้ผู้ดูแล 2 คนที่ต่างกันอนุมัติ

### ผู้ดูแลทำอุปกรณ์ที่มีพาสคีย์หายทั้งหมด

1. ยืนยันตัวตนผู้ดูแลนอกระบบ (เช่น วิดีโอคอลคู่บัตร หรือผู้ดูแลอีกคนยืนยัน)
2. `docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/cli/clear-admin-passkeys.js <userId หรือ LINE userId> "<เหตุผล>"`
   — ลบพาสคีย์ทั้งหมดของคนนั้น, เพิกถอนทุก session และบันทึก `admin.passkeys.cleared` (ผู้รัน = user ของ shell) ใน `AdminAuditLog`
3. ผู้ดูแลเข้าสู่ระบบใหม่แล้วลงทะเบียนพาสคีย์ภายใน 15 นาที (เหมือนข้อ 3 ด้านบน)

ถ้าแค่หายบางเครื่อง ผู้ดูแลลบพาสคีย์ของเครื่องที่หายเองได้ในส่วน "ความปลอดภัยผู้ดูแล" (ต้องยืนยันด้วยพาสคีย์ที่เหลือ)

### Release (image สำเร็จรูป)

push tag `v1.2.3` → GitHub Actions สร้าง `ghcr.io/bankforall/platform-{api,migrate,web}:1.2.3` พร้อม SBOM และ provenance attestation
web image ฝัง chain และ contract ที่จะยอมลงนามไว้ตอน build: ตั้ง repository variables `VITE_CHAIN_ID`, `VITE_FORWARDER_ADDRESS`,
`VITE_FACTORY_ADDRESS` (Settings → Secrets and variables → Actions → Variables) ให้ตรงกับ contract ที่ deploy แล้ว
ตรวจ image ก่อนใช้: `gh attestation verify oci://ghcr.io/bankforall/platform-api:1.2.3 -R bankforall/platform`

## 4. งานประจำ

| งาน | ความถี่ | วิธี |
| --- | --- | --- |
| ตรวจ KYC | ทุกวัน | `/admin` — ตรวจบัตรกับ selfie, ตั้งคะแนนเริ่มต้น (ค่าเริ่ม 100) |
| เติม gas | เมื่อ `gasLow` | โอน ETH บน Base ไปที่ address ที่ log แจ้ง |
| Backup | ทุกคืน | `deploy/backup.sh` ผ่าน cron (เข้ารหัสด้วย `BACKUP_PASSPHRASE` — เก็บ passphrase นอกเซิร์ฟเวอร์) + ส่งออกนอกเครื่อง (rclone/restic) |
| ตรวจ ingest errors | ทุกวัน | ตาราง `IngestError` ต้องว่าง; log มีคำว่า `ALERT:` ให้ดูทันที |
| ตรวจ audit log | ทุกสัปดาห์ | ตาราง `AdminAuditLog` (ตัดสิน KYC, ดูไฟล์ KYC, อนุมัติเปลี่ยนกุญแจ, เพิ่ม/ลบ/ล้างพาสคีย์ผู้ดูแล, `admin.stepup.failed`) |
| ทดสอบ restore | ทุกเดือน | restore ลงเครื่องทดสอบตามคำสั่งท้าย `backup.sh` |
| อัปเดตระบบ | ตามรอบ release | `git pull && docker compose ... up -d --build` (migration รันเอง) |
| Monitoring | ต่อเนื่อง | uptime check `GET /api/health` (HTTP 200 + `worker:true` + `gasLow:false`) |

## 5. การกู้คืน

| เหตุการณ์ | วิธี |
| --- | --- |
| ฐานข้อมูลเสีย/หาย | restore จาก backup; ข้อมูลวงจะ sync จาก chain ใหม่ได้เสมอ (indexer อ่านตั้งแต่ `DEPLOY_BLOCK`) ส่วน **KYC, สลิป, ชื่อผู้ใช้** ต้องมาจาก backup |
| `APP_ENCRYPTION_KEY` หาย | ไฟล์ KYC/สลิป/ซองประมูลที่เก็บไว้อ่านไม่ได้ถาวร → **เก็บสำเนา key แบบ offline 2 ที่** |
| ผู้ใช้เปลี่ยนเครื่อง | ผู้ใช้กู้คืนเองด้วยรหัสกู้คืน (หน้า "กู้คืนบัญชี") |
| ผู้ใช้หายทั้งเครื่องและรหัสกู้คืน | ผู้ใช้ login ด้วย LINE ในเครื่องใหม่ → "ลืมรหัสกู้คืนหรือทำเครื่องหาย" สร้างกุญแจใหม่และลงนามคำขอ → ผู้ดูแล 2 คน (คนละคน) ยืนยันตัวตนแล้วอนุมัติใน `/admin` → รอ `KEY_ROTATION_DELAY_HOURS` (ค่าเริ่ม 24 ชม., ผู้ใช้ยกเลิกได้และได้รับแจ้งเตือน) → worker ขอลายเซ็นจาก signer แล้วเรียก `rotateMember` ในทุกวงที่ยังดำเนินอยู่ (บันทึก `MemberRotated` เป็นหลักฐาน) |
| ต้องหยุดระบบฉุกเฉิน | admin เรียก `factory.pause()` → ทุกวงหยุดรับรายการบน chain ทันที |
| worker ค้าง | `docker compose ... restart worker` (ทำงานต่อจาก cursor ได้; รันหลายตัวได้ มี lease กันซ้ำ) |

## 6. สิ่งที่ยังต้องทำก่อนเปิดให้คนทั่วไปใช้

- [ ] ความเห็นทางกฎหมาย ([legal-checklist.md](./legal-checklist.md)) และข้อความ Terms/Privacy ฉบับจริงในหน้า consent
- [ ] Security audit ของ contract และ penetration test ของ API/web
- [ ] เลือกผู้ให้บริการตรวจสลิปอัตโนมัติ (ตอนนี้ `SLIP_VERIFIER=none` — ผู้รับเป็นผู้ยืนยัน) และ SMS ในไทย
- [ ] ย้าย factory admin ไป multisig (Safe), ตั้ง alerting ภายนอก (เช่น UptimeRobot/Better Stack) และ log shipping (ค้นหา `ALERT:` และ `audit:`)
- [x] WebAuthn/2FA สำหรับผู้ดูแล — [security.md §4](./security.md#4-พาสคีย์ผู้ดูแล-webauthn-2fa)
- [ ] Pilot แบบ invite-only บน Base Sepolia → Base mainnet

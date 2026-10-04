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
| SMS provider: **ThaiBulkSMS** (แนะนำ) หรือ Twilio | OTP | ข้อ 4.2 |
| ช่องทางแจ้งเตือน (Slack/Discord webhook หรือกลุ่ม LINE) + uptime monitor (healthchecks.io / Uptime Kuma / Better Stack) | แจ้งเตือนผู้ดูแล | ข้อ 4.1 |
| (ไม่บังคับ) **SlipOK** | ตรวจสลิปอัตโนมัติ | ข้อ 4.3 |
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
- worker เตือนใน log, ช่องทางแจ้งเตือน (ข้อ 4.1) และ `/api/health` (`gasLow: true`) เมื่อยอดต่ำกว่า `MIN_GAS_BALANCE_WEI`
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
- ระบบปฏิเสธการเริ่มถ้าไม่มี LINE Login, ใช้ SMS แบบ console, `PUBLIC_URL` ไม่ใช่ https หรือเลือก provider (ThaiBulkSMS/SlipOK) แต่ไม่ใส่ key
- ถ้าไม่มีช่องทางแจ้งเตือนหรือ heartbeat ระบบยังเริ่มได้แต่เขียน log `config: …` เตือน (เหตุผลในข้อ 4.1)

### ตั้งผู้ดูแล (admin) คนแรก

1. ผู้ดูแลเข้าสู่ระบบด้วย LINE หนึ่งครั้ง
2. `docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/cli/promote-admin.js <userId หรือ LINE userId>`
3. ผู้ดูแลออกจากระบบแล้วเข้าใหม่ → เมนู `/admin` (ตรวจ KYC, อนุมัติคำขอเปลี่ยนกุญแจ)
4. ตั้งผู้ดูแล **อย่างน้อย 2 คน** — การกู้บัญชีต้องให้ผู้ดูแล 2 คนที่ต่างกันอนุมัติ

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
| ตรวจ ingest errors | ทุกวัน | ตาราง `IngestError` ต้องว่าง; ทุก `ALERT:` ถูกส่งเข้าช่องทางแจ้งเตือน (ข้อ 4.1) ให้ดูทันที |
| ตรวจ audit log | ทุกสัปดาห์ | ตาราง `AdminAuditLog` (ตัดสิน KYC, ดูไฟล์ KYC, อนุมัติเปลี่ยนกุญแจ) |
| ทดสอบ restore | ทุกเดือน | restore ลงเครื่องทดสอบตามคำสั่งท้าย `backup.sh` |
| อัปเดตระบบ | ตามรอบ release | `git pull && docker compose ... up -d --build` (migration รันเอง) |
| Monitoring | ต่อเนื่อง | uptime check `GET /api/health` + heartbeat ของ worker + webhook แจ้งเตือน (ข้อ 4.1) |

### 4.1 การแจ้งเตือน (alerting) และ uptime

ทุกเหตุการณ์ที่ต้องให้คนดู ระบบเรียก `alert()` (`apps/api/src/alert.ts`) ซึ่ง **เขียน log `ALERT: …` เสมอ** และส่งไปช่องทางที่ตั้งไว้:

| ตัวแปร | บริการที่ได้รับ | ความหมาย |
| --- | --- | --- |
| `ALERT_WEBHOOK_URL` | api, worker, signer | webhook ที่รับ POST JSON (Slack Incoming Webhook, Discord webhook, หรือระบบของเราเอง) |
| `ALERT_WEBHOOK_FORMAT` | api, worker, signer | `slack` (`{text}`), `discord` (`{content}`), `json` (`{service,site,role,key,message,detail,at}`) |
| `ALERT_LINE_TO` | api, worker | group id ของกลุ่ม LINE ผู้ดูแล (ขึ้นต้นด้วย `C`) ใช้ `LINE_MESSAGING_TOKEN` เดิม — signer ไม่ได้รับ token นี้ จึงแจ้งผ่าน webhook เท่านั้น |
| `ALERT_THROTTLE_MINUTES` | api, worker, signer | เหตุการณ์ key เดียวกันส่งไม่เกิน 1 ครั้งต่อช่วงนี้ (ค่าเริ่ม 30 นาที; ใช้ Redis `SET NX EX` ร่วมกันทุก process) — log ยังเขียนทุกครั้ง |
| `ALERT_JOB_FAILURES` | worker | แจ้งเมื่อ job ใดใน worker loop ล้มเหลวติดกันครบจำนวนนี้ (ค่าเริ่ม 5) |
| `INDEXER_LAG_ALERT_BLOCKS` | worker | แจ้งเมื่อ indexer ตามหลัง head ของ chain เกินจำนวน block นี้ (ค่าเริ่ม 300 ≈ 10 นาทีบน Base) |
| `HEARTBEAT_URL` | worker | URL แบบ push ที่ worker เรียก (GET) หลังทุก loop ที่สำเร็จครบ (ไม่เกินนาทีละครั้ง) |

เหตุการณ์ที่แจ้ง: gas ของ relayer/keeper/attester ต่ำ, ingest ล้มเหลว, ซองประมูลไม่ถูกเปิดทันเวลา, เปลี่ยนกุญแจล้มเหลว,
job ของ worker ล้มเหลวซ้ำ, indexer ตามหลัง, signer ติดต่อไม่ได้ (api และ worker ตรวจ `GET /health` ของ signer ทุกนาที/ทุก loop),
`attestSlip` ล้มเหลว, ผู้ให้บริการตรวจสลิปต้องการผู้ดูแล (key/โควตา/branch) หรือเลิกลองหลังครบจำนวนครั้ง

**ข้อมูลที่ส่งออกนอกเครื่องถูกตัดข้อมูลลับ/ส่วนบุคคล:** ฟิลด์ที่ชื่อเกี่ยวกับ key/secret/token/password/signature/salt/phone/nationalId/promptPay
ถูกแทนด้วย `[redacted]`; ในข้อความ (เช่น error message) เบอร์มือถือไทย, เลข 13 หลัก, ค่า hex 32 byte (กุญแจ — tx hash ก็ถูกตัดด้วย ดูฉบับเต็มใน log ของเครื่อง)
และรหัสผ่านใน URL ถูกปิดบัง ส่วน address ของ contract/กระเป๋า, id และจำนวนยังคงอยู่ การส่งแจ้งเตือนไม่ทำให้งานหลักล้ม (ส่งไม่สำเร็จ → log `alert delivery failed`)

ขั้นตอนตั้งค่า:

1. **Slack:** สร้าง app → Incoming Webhooks → เลือก channel → ใส่ URL ใน `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_FORMAT=slack`
   **Discord:** Channel settings → Integrations → Webhooks → `ALERT_WEBHOOK_FORMAT=discord`
2. **กลุ่ม LINE (ไม่บังคับ):** เชิญ Official Account เข้ากลุ่มผู้ดูแล (เปิด "Allow bot to join group chats" ใน LINE Official Account Manager)
   หา group id จาก webhook event `join` (`source.groupId`) แล้วใส่ใน `ALERT_LINE_TO` — ข้อความ push นับโควตาข้อความของ OA
3. **Heartbeat:** สร้าง check ใน healthchecks.io (period 1 นาที, grace 5 นาที) หรือ monitor แบบ "Push" ใน Uptime Kuma → ใส่ URL ใน `HEARTBEAT_URL`
   ถ้า worker หยุด/ค้าง หรือ job ล้มทุกรอบ ping จะหยุดและบริการนั้นแจ้งเตือนเอง (ตรวจได้แม้ทั้งเครื่องดับ — สิ่งที่ webhook จากในเครื่องทำไม่ได้)
4. **Uptime check ภายนอก** (UptimeRobot / Better Stack / Uptime Kuma นอกเครื่อง): HTTP(S) monitor ที่ `https://<domain>/api/health` ทุก 1–5 นาที
   แจ้งเมื่อไม่ใช่ HTTP 200 (DB/Redis/RPC/S3 ล่ม) และถ้าบริการรองรับ keyword ให้ตรวจว่า body มี `"worker":true` และ `"gasLow":false`
   (endpoint นี้ cache 5 วินาทีและจำกัด 60 ครั้ง/นาที)
5. ทดสอบ: หยุด signer ชั่วคราว (`docker compose ... stop signer`) → ภายใน 1 นาทีต้องมีแจ้งเตือน "signer service unreachable" → `start signer`

> **ทำไม "เตือน" แทน "ไม่ยอมเริ่ม" เมื่อไม่มีช่องทางแจ้งเตือน:** ใน production ถ้าไม่มี `ALERT_WEBHOOK_URL`/`ALERT_LINE_TO` (หรือ worker ไม่มี `HEARTBEAT_URL`)
> ระบบเขียน log `config: …` ตอนเริ่มแต่ยังทำงาน เพราะ (1) การแจ้งเตือนไม่กระทบความปลอดภัยของเงินหรือข้อมูล — ต่างจากกุญแจหรือ https ที่เราบังคับ
> (2) ผู้ดูแลบางรายส่ง log ไประบบกลาง (Loki/Better Stack/CloudWatch) และตั้งแจ้งเตือนจากคำว่า `ALERT:` อยู่แล้ว
> (3) ไม่ควรให้ webhook ที่หมดอายุหรือบริการภายนอกล่มทำให้ระบบเริ่มไม่ได้ตอนกู้เหตุ — **แต่ต้องมีอย่างน้อยหนึ่งช่องทางก่อนเปิดใช้งานจริง** (อยู่ใน checklist ข้อ 6)

### 4.2 SMS: ThaiBulkSMS

1. สมัคร thaibulksms.com → ซื้อเครดิต (แนะนำแบบ corporate สำหรับ OTP) → ขอ **Sender name** (เช่น `BankForAll`) และรอการอนุมัติ
2. Setting → API Key → สร้าง API Key/Secret → ใส่ `THAIBULKSMS_API_KEY`, `THAIBULKSMS_API_SECRET`, `THAIBULKSMS_SENDER`, `SMS_PROVIDER=thaibulksms`
   (`THAIBULKSMS_FORCE=standard|corporate` บังคับประเภท SMS; เว้นว่าง = ตามที่ตั้งใน dashboard) — ตัวแปรเหล่านี้ส่งให้ **api เท่านั้น**
3. ระบบไม่ยอมเริ่ม api ถ้าเลือก `thaibulksms` แต่ขาดค่าใดค่าหนึ่ง

การเรียก API (`apps/api/src/providers/sms.ts`): `POST https://api-v2.thaibulksms.com/sms`, HTTP Basic (key:secret), form `msisdn` (แปลงเป็น `0XXXXXXXXX`),
`message`, `sender`, `force` — ตามคู่มือ API v2 (assets.thaibulksms.com, ตรวจเมื่อ 2026-10) ถ้า HTTP ไม่ใช่ 2xx, มี `error` หรือเบอร์อยู่ใน
`bad_phone_number_list` ถือว่าส่งไม่สำเร็จ ข้อความ error มีเฉพาะ HTTP status และรหัส/ชื่อ error ของผู้ให้บริการ (ไม่มีเบอร์ OTP หรือ key)
**ผู้ดูแลควรทดสอบส่ง OTP จริง 1 ครั้งบน staging** เพื่อยืนยันรูปแบบ response กับบัญชีของตน

### 4.3 ตรวจสลิปอัตโนมัติ: SlipOK (ไม่บังคับ)

ค่าเริ่ม `SLIP_VERIFIER=none` — ผู้รับเงินเป็นผู้ยืนยันเอง ถ้าเปิด SlipOK, worker ส่ง **เฉพาะรูปสลิปและยอดเงิน** ไปตรวจ
(ไม่ส่งชื่อ เบอร์ PromptPay หรือข้อมูลวง) ผลที่ได้ VERIFIED → signer เรียก `attestSlip` บันทึกบน chain ว่าสลิปผ่านการตรวจ

1. สมัคร slipok.com → สร้าง **สาขา (branch)** สำหรับ API → ได้ Branch ID และ API key → `SLIP_VERIFIER=slipok`, `SLIPOK_BRANCH_ID`, `SLIPOK_API_KEY` (ส่งให้ **worker เท่านั้น**)
2. **อย่าผูกบัญชีรับเงินกับสาขา** (หรือปิดการตรวจบัญชีผู้รับของสาขา): ผู้รับในวงแชร์คือสมาชิกแต่ละคน ไม่ใช่บัญชีของเรา —
   ถ้า SlipOK ตอบรหัส 1014 (ผู้รับไม่ตรงกับบัญชีสาขา) ระบบถือว่าตั้งค่าผิด แจ้งเตือนผู้ดูแล และไม่ตัดสินว่าสลิปผิด
3. ระบบไม่ยอมเริ่ม worker ถ้าเลือก `slipok` แต่ขาด Branch ID/API key

การตัดสิน (`apps/api/src/providers/slip.ts`, request: `POST https://api.slipok.com/api/line/apikey/<BRANCH_ID>`, header `x-authorization`, multipart `files` + `amount` + `log=true`):

| ผลจาก SlipOK | สถานะสลิป |
| --- | --- |
| `success` + ยอดตรง (สตางค์) + PromptPay ผู้รับ (ที่ถูกปิดบางหลัก เช่น `086xxx0000`) ตรงกับผู้รับรอบนั้นในทุกหลักที่เห็น (อย่างน้อย 4 หลัก) | `VERIFIED` |
| ยอดไม่ตรง, ผู้รับไม่ตรง, สลิปซ้ำ (1012), ไม่มี QR/อ่านรูปไม่ได้/QR หมดอายุ (1000, 1005–1008, 1011, 1013) | `FAILED` + แจ้งผู้จ่าย |
| สลิปไม่แสดง PromptPay ของผู้รับ (เช่น โอนเข้าเลขบัญชี) จึงเทียบไม่ได้ | `SKIPPED` (ผู้รับยืนยันเอง) |
| network/timeout/5xx, 1009–1010 (ธนาคารขัดข้อง/ต้องรอ), 1001–1004/1014 (key, branch, โควตา — **แจ้งเตือนทันที**) | คง `PENDING` แล้วลองใหม่แบบ backoff 1, 2, 4 … 60 นาที; ครบ `SLIP_VERIFY_MAX_ATTEMPTS` (ค่าเริ่ม 8) → `SKIPPED` + แจ้งเตือน |

"สลิปซ้ำ" ที่เกิดหลังจากเราเคยส่งสลิปเดียวกันแล้ว error (อาจเป็นครั้งก่อนที่ไปถึง SlipOK แล้ว) จะถูกนับเป็น `SKIPPED` ไม่ใช่ `FAILED` เพื่อไม่กล่าวหาผู้จ่าย
**ข้อที่ผู้ดูแลต้องตรวจกับเอกสาร/บัญชี SlipOK ของตนก่อนเปิดใช้:** รูปแบบ error (`{success:false, code, message}`), ความหมายของ `log` ในแพ็กเกจ,
และรูปแบบ `receiver.proxy.value` ที่ถูกปิดบัง (โค้ดเทียบเฉพาะหลักที่เห็น และต้องยาวเท่ากับ PromptPay ID) — ทดสอบด้วยสลิปจริงบน staging

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
- [ ] ตั้ง SMS ไทย (ThaiBulkSMS, ข้อ 4.2) และตัดสินใจเรื่องตรวจสลิปอัตโนมัติ (SlipOK, ข้อ 4.3 — หรือคง `SLIP_VERIFIER=none` ให้ผู้รับยืนยัน) แล้วทดสอบกับของจริงบน staging
- [ ] ตั้งช่องทางแจ้งเตือน + `HEARTBEAT_URL` + uptime check ภายนอก (ข้อ 4.1) และทดสอบว่ามีแจ้งเตือนจริง
- [ ] ย้าย factory admin ไป multisig (Safe) และ log shipping (ค้นหา `ALERT:` และ `audit:`)
- [ ] WebAuthn/2FA สำหรับผู้ดูแล — ดูความเสี่ยงที่ยอมรับใน [security.md](./security.md#3-ความเสี่ยงที่ยอมรับและยังต้องทำ)
- [ ] Pilot แบบ invite-only บน Base Sepolia → Base mainnet

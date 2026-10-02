# Deployment & Operations Runbook

[← v2](./README.md)

ติดตั้งบน VPS เครื่องเดียวด้วย Docker Compose: Caddy (HTTPS อัตโนมัติ) + API + worker + PostgreSQL + Redis + MinIO
โดยใช้ smart contract บน **Base** (ทดสอบบน Base Sepolia ก่อน)

```
Internet ──443──▶ web (Caddy: PWA + /api proxy, TLS) ──▶ api:4000 ──▶ postgres / redis / minio
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

## 1. กุญแจ (keys)

| กุญแจ | หน้าที่ | เก็บที่ | ต้องมี ETH |
| --- | --- | --- | --- |
| **Admin** | `DEFAULT_ADMIN_ROLE` ของ factory (pause, setCaps, จัดการ role) | **hardware wallet / multisig (Safe)** — ห้ามอยู่บนเซิร์ฟเวอร์ | เล็กน้อย |
| **Attester** | ลงนามรับรอง KYC, key rotation, `attestSlip` | `.env.production` (hot) | ~0.005 ETH |
| **Relayer** | ส่ง transaction แทนผู้ใช้ (จ่าย gas) | `.env.production` (hot) | ~0.02 ETH |
| **Keeper** | เดินวงตามเวลา (เปิดซอง, ปิดประมูล, ผิดนัด, รอบถัดไป) | `.env.production` (hot) | ~0.01 ETH |

```bash
cast wallet new            # สร้างกุญแจ (Foundry) — ทำบนเครื่องที่ปลอดภัย
```

- ทั้ง 3 hot keys **ต้องต่างกัน** (ระบบไม่ยอมเริ่มถ้าซ้ำกัน)
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
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl https://<domain>/api/health              # {"ok":true,...,"worker":true,"gasLow":false}
```

> ⚠️ รัน `docker compose` จาก shell ที่ **ไม่มี** ตัวแปรชื่อเดียวกันค้างอยู่ — ตัวแปรใน shell มีลำดับสูงกว่า `--env-file`
> (เจอจริงตอนทดสอบ: MinIO ได้รหัสผ่านคนละค่ากับ API) ถ้าไม่แน่ใจให้ใช้ `env -i PATH=$PATH HOME=$HOME docker compose ...`

- `migrate` รัน `prisma migrate deploy` อัตโนมัติก่อน api/worker ทุกครั้งที่ `up`
- **ห้าม** ตั้ง `DEV_LOGIN=true` ใน production (ระบบไม่ยอมเริ่ม)
- ระบบปฏิเสธการเริ่มถ้าไม่มี LINE Login, ใช้ SMS แบบ console หรือ `PUBLIC_URL` ไม่ใช่ https

### ตั้งผู้ดูแล (admin) คนแรก

1. ผู้ดูแลเข้าสู่ระบบด้วย LINE หนึ่งครั้ง
2. `docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/cli/promote-admin.js <userId หรือ LINE userId>`
3. ผู้ดูแลออกจากระบบแล้วเข้าใหม่ → เมนู `/admin` (ตรวจ KYC, กู้คืนกุญแจ)

## 4. งานประจำ

| งาน | ความถี่ | วิธี |
| --- | --- | --- |
| ตรวจ KYC | ทุกวัน | `/admin` — ตรวจบัตรกับ selfie, ตั้งคะแนนเริ่มต้น (ค่าเริ่ม 100) |
| เติม gas | เมื่อ `gasLow` | โอน ETH บน Base ไปที่ address ที่ log แจ้ง |
| Backup | ทุกคืน | `deploy/backup.sh` ผ่าน cron + ส่งออกนอกเครื่อง (rclone/restic) |
| ทดสอบ restore | ทุกเดือน | restore ลงเครื่องทดสอบตามคำสั่งท้าย `backup.sh` |
| อัปเดตระบบ | ตามรอบ release | `git pull && docker compose ... up -d --build` (migration รันเอง) |
| Monitoring | ต่อเนื่อง | uptime check `GET /api/health` (HTTP 200 + `worker:true` + `gasLow:false`) |

## 5. การกู้คืน

| เหตุการณ์ | วิธี |
| --- | --- |
| ฐานข้อมูลเสีย/หาย | restore จาก backup; ข้อมูลวงจะ sync จาก chain ใหม่ได้เสมอ (indexer อ่านตั้งแต่ `DEPLOY_BLOCK`) ส่วน **KYC, สลิป, ชื่อผู้ใช้** ต้องมาจาก backup |
| `APP_ENCRYPTION_KEY` หาย | ไฟล์ KYC/สลิป/ซองประมูลที่เก็บไว้อ่านไม่ได้ถาวร → **เก็บสำเนา key แบบ offline 2 ที่** |
| ผู้ใช้เปลี่ยนเครื่อง | ผู้ใช้กู้คืนเองด้วยรหัสกู้คืน (หน้า "กู้คืนบัญชี") |
| ผู้ใช้หายทั้งเครื่องและรหัสกู้คืน | ยืนยันตัวตนใหม่ → ผู้ใช้สร้างกุญแจใหม่ในเครื่องใหม่ → admin เรียก `POST /api/admin/users/:id/rotate-key {newAddress}` → contract ย้ายสมาชิกภาพในทุกวงที่ยังดำเนินอยู่ (`rotateMember`, บันทึก `MemberRotated` เป็นหลักฐาน) |
| ต้องหยุดระบบฉุกเฉิน | admin เรียก `factory.pause()` → ทุกวงหยุดรับรายการบน chain ทันที |
| worker ค้าง | `docker compose ... restart worker` (ทำงานต่อจาก cursor ได้; รันหลายตัวได้ มี lease กันซ้ำ) |

## 6. สิ่งที่ยังต้องทำก่อนเปิดให้คนทั่วไปใช้

- [ ] ความเห็นทางกฎหมาย ([legal-checklist.md](./legal-checklist.md)) และข้อความ Terms/Privacy ฉบับจริงในหน้า consent
- [ ] Security audit ของ contract และ penetration test ของ API/web
- [ ] เลือกผู้ให้บริการตรวจสลิปอัตโนมัติ (ตอนนี้ `SLIP_VERIFIER=none` — ผู้รับเป็นผู้ยืนยัน) และ SMS ในไทย
- [ ] ย้าย admin key ไป multisig, ตั้ง alerting ภายนอก (เช่น UptimeRobot/Better Stack) และ log shipping
- [ ] Pilot แบบ invite-only บน Base Sepolia → Base mainnet

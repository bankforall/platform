# Bank For All — platform

[![CI](https://github.com/bankforall/platform/actions/workflows/ci.yml/badge.svg)](https://github.com/bankforall/platform/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**A transparent peer-share (ROSCA, Thai _เปียแชร์_) platform that never holds anyone's money.**
Members pay each other directly with PromptPay; smart contracts on Base decide who receives the pool each round,
enforce the rules and keep tamper-proof evidence. Every action is signed with a key that never leaves the user's
phone — no crypto knowledge needed. Built with Solidity, TypeScript, Fastify, Prisma, React and Playwright.
Documentation is mostly in Thai — see [`docs/v2`](docs/v2/README.md).

---

แพลตฟอร์มเปียแชร์ที่ **ไม่ถือเงิน**: สมาชิกโอนกันเองผ่าน PromptPay ส่วน smart contract บน Base ทำหน้าที่ตัดสินผู้รับแต่ละรอบ
บังคับกติกา และเก็บหลักฐานที่ปลอมไม่ได้ ผู้ใช้ลงนามทุกรายการด้วยกุญแจในเครื่องของตัวเอง (ไม่ต้องรู้จัก crypto)

เอกสาร: [`docs/v2/`](./docs/v2/README.md) — [กติกา](./docs/v2/rules-spec.md) · [สถาปัตยกรรม](./docs/v2/architecture.md) · [deploy](./docs/v2/deployment.md) · [หน้าจอ](./design/screen-inventory.md)

```
packages/contracts   CircleFactory + Circle (Solidity, Foundry)
packages/shared      กติกา, API contract (zod), EIP-712, PromptPay, ABIs
apps/api             Fastify API + worker (indexer, keeper, reminders) + Prisma
apps/web             PWA (React + Vite + Tailwind)
e2e                  Playwright (หลายผู้ใช้ในเบราว์เซอร์จริง)
deploy               docker-compose.prod.yml, Caddyfile, backup
```

## พัฒนาในเครื่อง

ต้องมี Node 24 LTS, pnpm 12 (`corepack enable`), Docker และ [Foundry](https://getfoundry.sh)

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d      # postgres, redis, s3 (SeaweedFS), anvil
./scripts/dev-deploy.sh                             # deploy contracts → เขียน apps/api/.env
pnpm --filter @bankforall/shared build
pnpm --filter @bankforall/api exec prisma generate  # Prisma client → apps/api/src/generated
cd apps/api && set -a && . ./.env && set +a && npx prisma migrate deploy
npx tsx src/server.ts                               # API :4000
npx tsx src/worker.ts                               # worker (อีก terminal)
pnpm --filter @bankforall/web dev                   # http://localhost:5173 (มี dev login, OTP แสดงบนจอ)
```

ทำให้ตัวเองเป็น admin (ตรวจ KYC): `cd apps/api && npx tsx src/cli/promote-admin.ts dev:<ชื่อที่ใช้ login>` แล้ว login ใหม่

## ทดสอบ

```bash
cd packages/contracts && forge test                       # contracts
pnpm --filter @bankforall/shared test                      # กติกา + PromptPay
pnpm --filter @bankforall/api test                         # unit
cd apps/api && set -a && . ./.env && set +a && pnpm test:e2e   # ทั้งวงผ่าน HTTP + chain จริง
pnpm --filter @bankforall/web test
pnpm --filter @bankforall/e2e test                         # เบราว์เซอร์ (ต้องรัน api/worker/web ไว้)
```

## กฎของ repo

- กติกาวงแชร์มี 2 implementation (`circle-math.ts` และ `Circle.sol`) — แก้ที่หนึ่งต้องแก้อีกที่ และเพิ่ม case ใน `packages/shared/test-vectors/circle-math.json`
- แก้ contract แล้วรัน `pnpm --filter @bankforall/contracts build` เพื่อ export ABI ไปที่ shared
- ตาราง Circle/Membership/Round/Payment เขียนได้จาก `services/ingest.ts` เท่านั้น
- ห้ามนำข้อมูลส่วนบุคคลขึ้น chain; จำนวนเงินเป็นสตางค์ (bigint) เสมอ

## License

[GNU AGPL-3.0](LICENSE). If you run a modified version as a service, you must offer its source code to your users.
Security issues: see [SECURITY.md](SECURITY.md). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

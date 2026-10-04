# apps/web — Bank For All PWA

Mobile-first PWA (Thai) — React 19 + Vite 8 + Tailwind 4 (CSS-first `@theme` in `src/styles.css`) + React Router 8 + TanStack Query 5 + viem 2. Node 24 / pnpm 12.
Talks to `apps/api` only through the contract in `@bankforall/shared` (`src/api/endpoints.ts` validates every response with the shared zod schemas).

```bash
pnpm --filter @bankforall/shared build     # web imports shared/dist
pnpm --filter @bankforall/web dev          # http://localhost:5173, proxies /api → http://localhost:4000
pnpm --filter @bankforall/web test         # vitest (wallet crypto, signing flow, screen smoke tests)
pnpm --filter @bankforall/web build        # dist/ (static; serve behind Caddy with /api reverse-proxied)
```

## Structure

```
src/api/        client.ts (typed fetch, CSRF header, error mapping) · endpoints.ts (all routes + query keys)
src/wallet/     crypto.ts (recovery code, backup AES-GCM/PBKDF2, PIN hash) · device.ts (IndexedDB key, PIN lock-out) · idb.ts
src/hooks/      useIntent.tsx (prepare → PIN → sign EIP-712 → submit) · session.ts (me/config/local key)
src/components/ ui, overlay (toast, bottom sheet, PIN pad), widgets (countdown, QR, donut, tabs), layout, CircleCard, SeatPicker, JoinPanel
src/screens/    Welcome, HowItWorks, Login, onboarding/*, Restore, Home, Circles, CreateCircle, JoinByInvite, circle/* (5 tabs), Notifications, Profile, Admin
```

## Security model (device wallet)

- Signing key generated in the browser, stored in IndexedDB encrypted with a **non-extractable** AES-GCM key.
- Every signature requires the 6-digit PIN (PBKDF2-hashed verifier; 5 wrong tries → 5-minute lock).
- Backup = AES-GCM(PBKDF2-SHA256(120-bit recovery code, 310k iterations)) uploaded to `PUT /api/me/wallet`; the server never sees the code.
- `PUT /api/me/wallet` carries a proof: personal_sign of `walletProofMessage(userId, address)` with the device key.
- Lost device and code → "ลืมรหัสกู้คืนหรือทำเครื่องหาย" on /restore: a new key + PIN + recovery code are created on the new
  device, `POST /api/me/key-rotation` is sent with a `keyRotationMessage` proof, two different admins approve (requester must be
  KYC-verified), the switch happens 24 h later (the user can cancel; other devices show a warning). The new key's backup and
  wallet proof wait in IndexedDB and are uploaded once `me.walletAddress` equals the new key.
- No blind signing: before the PIN pad, `src/wallet/verifyIntent.ts` checks the EIP-712 domain (name, version, chain,
  forwarder), `from` = local key, `value` = 0, decodes `data` with the factory/circle ABI (only createCircle, join, start,
  cancel, commitBid, declarePayment, confirmReceipt, rejectPayment, dispute), checks `to` (factory, or the circle on screen),
  the server `kind`, and the arguments against what the user entered; the sheet is rendered from the decoded call
  (server `summary` only as small text).
- Chain pins: production builds need `VITE_CHAIN_ID`, `VITE_FORWARDER_ADDRESS`, `VITE_FACTORY_ADDRESS` (Docker build args).
  `/api/config` must agree with them, otherwise nothing is signed. Without pins, dev builds trust `/api/config` (console warning)
  and production builds refuse to sign.

The service worker never caches `/api/*`.

## End-to-end tests (real API + chain)

`e2e/` drives this app in Chromium (390×844) against the real API, worker and an anvil chain.

```bash
docker compose -f docker-compose.dev.yml up -d          # postgres, redis, s3 (SeaweedFS), anvil (+ contracts deployed)
cd apps/api && set -a && . ./.env && set +a
npx tsx src/server.ts &                                  # API :4000 (or PORT=4001 …)
npx tsx src/worker.ts &                                  # keeper/indexer
cd ../.. && API_PROXY_TARGET=http://localhost:4000 pnpm --filter @bankforall/web dev &
cd e2e && npx playwright test                            # test:e2e — report in e2e/playwright-report
```

Covers: dev login → full onboarding (OTP, PromptPay, consent, wallet PIN + recovery code, KYC upload) for 3 users,
admin KYC approval, Float circle creation with preview check, join by invite, start, round-1 PromptPay slip + recipient
confirmation, 30-day warp, sealed bids (commit → keeper reveal → close), winner, evidence report, and wallet restore
from the recovery code on a fresh browser followed by a real signed action. Names are unique per run; chain state persists.

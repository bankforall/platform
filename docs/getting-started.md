# Getting Started — รันระบบในเครื่อง

[← กลับหน้าหลัก](./README.md)

## ข้อกำหนดเบื้องต้น

- Node.js 16+ (แนะนำ 18/20 — `node:16` ใน Dockerfile หมดอายุการ support แล้ว)
- Docker + Docker Compose (สำหรับ MongoDB)
- Git

## 1. Clone ทุก repo

```bash
mkdir bankforall && cd bankforall
for r in bank4all api web bank4all-smartcontract bank4all-blockathon2023Frontend; do
  git clone https://github.com/bankforall/$r.git
done
```

## 2. Track A — `api` + `web`

### 2.1 รัน MongoDB + API

```bash
cd api
docker compose -f docker-compose.db.yml up -d     # MongoDB ที่ localhost:27017

cat > .env <<'EOF'
PORT=5000
MONGO_URI=mongodb://localhost:27017/bank4all
JWT_SECRET_KEY=change-me-to-a-long-random-string
NODE_ENV=development
EOF

npm install
npm run dev        # → http://localhost:5000  (Swagger: /docs)
```

### 2.2 ทดสอบ API ด้วย curl

```bash
# สมัคร (password ต้องเป็น a-z A-Z 0-9 เท่านั้น ยาว 8–30, phone 10 ตัว)
TOKEN=$(curl -s -X POST localhost:5000/auth/sign-up -H 'Content-Type: application/json' \
  -d '{"fullname":"Test User","email":"test@example.com","password":"Password123","phoneNumber":"0812345678"}' \
  | sed -E 's/.*"access_token":"([^"]+)".*/\1/')

# ฝากเงิน แล้วดูยอด
curl -s -X POST localhost:5000/transactions/deposit -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"amount":1000}'
curl -s localhost:5000/users/summary -H "Authorization: Bearer $TOKEN"

# สร้างห้องแชร์
curl -s -X POST localhost:5000/peershare-rooms -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "roomName":"Demo Room","paymentTerm":500,"paymentTermUnit":"1w","creditRequirement":"C",
    "maxMember":5,"typeRoom":"Float","private":false,"bidTimeOut":"1d",
    "startBidDate":"2030-01-01T00:00:00Z"}'

# ดูรายการห้อง
curl -s localhost:5000/peershare-rooms -H "Authorization: Bearer $TOKEN"
```

### 2.3 รัน Web

`web` hardcode URL เป็น `http://10.2.150.92:5000` และใช้ path เก่า ต้องแก้ก่อน (ดู [known-issues.md](./known-issues.md#1-web-และ-api-ไม่ตรงกัน)) ทางเลือกที่เร็วที่สุด:

```bash
cd web
# 1) ชี้ไปที่ API ในเครื่อง
grep -rl '10.2.150.92:5000' src/service | xargs sed -i 's#http://10.2.150.92:5000#http://localhost:5000#g'
# 2) อัปเดต path ให้ตรงกับ api ปัจจุบัน
sed -i 's#/auth/signin#/auth/sign-in#; s#/auth/signup#/auth/sign-up#' src/service/auth.service.tsx
sed -i 's#/user/summary#/users/summary#' src/service/summary.service.tsx
sed -i 's#/transaction/#/transactions/#g' src/service/account-transaction.service.tsx
sed -i 's#/peershare-room#/peershare-rooms#g' src/service/peer-sharing.service.tsx

npm install
npm run dev        # → http://localhost:3000
```

> ทางที่ดีกว่าในระยะยาว: ย้าย base URL ไปไว้ใน `import.meta.env.VITE_API_URL` และรวม `fetch` ไว้ใน client เดียว

### 2.4 ทั้งหมดด้วย Docker (API อย่างเดียว)

```bash
cd api && docker compose up -d --build     # API → http://localhost:8080, Mongo → 27017
```

## 3. Track B — `bank4all-smartcontract`

```bash
cd bank4all-smartcontract
npm install
echo "JWT_SECRET=dev-secret" > .env
(cd config && node genMockdb.js)            # สร้าง config/mockdb.json
node server.js                              # → http://localhost:1234
```

ทดลอง flow แบบ Instant (ใช้บัญชีทดสอบจาก `config/genMockdb.js` — รหัสผ่านอยู่ในคอมเมนต์ของไฟล์):

```bash
T1=$(curl -s -X POST localhost:1234/login -H 'Content-Type: application/json' \
  -d '{"email":"friend@bank4all.com","password":"<ดูใน genMockdb.js>"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
T2=$(curl -s -X POST localhost:1234/login -H 'Content-Type: application/json' \
  -d '{"email":"petch@bank4all.com","password":"<ดูใน genMockdb.js>"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
G=cb10ab5908127a3bded78cb35fe112f52fc365d0   # กลุ่ม Float/Instant, Petch = host

for T in $T1 $T2; do curl -s -X POST localhost:1234/ready -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d "{\"groupId\":\"$G\"}"; done
curl -s -X POST localhost:1234/start -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d "{\"groupId\":\"$G\"}"
curl -s -X POST localhost:1234/bid -H "Authorization: Bearer $T1" -H 'Content-Type: application/json' -d "{\"groupId\":\"$G\",\"bidPropose\":100}"
curl -s -X POST localhost:1234/bid -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d "{\"groupId\":\"$G\",\"bidPropose\":150}"
# ดู log ของ server: "Biding winner is user: 2"
```

ส่วน Quorum (`smartcontracts/*.js`) ต้องมี Quorum node ที่มี `../data/geth.ipc` และต้องแก้บั๊กก่อน — ดู [known-issues.md](./known-issues.md#bank4all-smartcontract)

## 4. Track B — `bank4all-blockathon2023Frontend`

```bash
cd bank4all-blockathon2023Frontend
npm install && npm install vue-router@3
npm run serve      # → http://localhost:8080/main
```

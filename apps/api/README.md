# apps/api — Backend (ยังไม่เริ่ม)

NestJS + Prisma (PostgreSQL) + Passport LINE OIDC + Swagger

หน้าที่: LINE login + OTP, KYC, ออก `Attestation` (EIP-712, ATTESTER key ใน KMS), relayer/paymaster สำหรับ tx ของผู้ใช้,
สร้าง PromptPay QR ตาม `amountDue`, รับสลิป + ตรวจกับ slip-verification API แล้วเรียก `attestSlip`, สร้าง Evidence Pack (PDF)

Data model และ API: ดู [`../../../docs/v2/architecture.md`](../../../docs/v2/architecture.md)

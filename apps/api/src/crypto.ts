import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** AES-256-GCM with a random 12-byte IV. Output: iv | tag | ciphertext. */
export class Encryptor {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("encryption key must be 32 bytes");
  }

  encrypt(plain: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  decrypt(blob: Buffer): Buffer {
    const decipher = createDecipheriv("aes-256-gcm", this.key, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
  }

  encryptString(s: string): string {
    return this.encrypt(Buffer.from(s, "utf8")).toString("base64");
  }

  decryptString(s: string): string {
    return this.decrypt(Buffer.from(s, "base64")).toString("utf8");
  }
}

export function hmac(key: string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Uniform random numeric code (rejection sampling, no modulo bias). */
export function randomDigits(n: number): string {
  let out = "";
  while (out.length < n) {
    const b = randomBytes(1)[0]!;
    if (b < 250) out += String(b % 10);
  }
  return out;
}

/** Human-friendly invite code without ambiguous characters. */
export function inviteCode(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  while (out.length < length) {
    const b = randomBytes(1)[0]!;
    if (b < 256 - (256 % alphabet.length)) out += alphabet[b % alphabet.length];
  }
  return out;
}

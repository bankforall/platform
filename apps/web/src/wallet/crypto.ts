import type { WalletBackup } from "@bankforall/shared";

/**
 * Cryptography for the device wallet. Everything runs on WebCrypto; nothing secret leaves the device
 * except the backup, which is encrypted with a 120-bit recovery code the server never sees.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const RECOVERY_CODE_LENGTH = 24; // 24 base32 chars = 120 bits
export const BACKUP_ITERATIONS = 310_000;
const PIN_ITERATIONS = 150_000;

const enc = new TextEncoder();

export type Bytes = Uint8Array<ArrayBuffer>;

export function randomBytes(n: number): Bytes {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function fromHex(hex: string): Bytes {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 15 random bytes as 24 base32 chars, grouped "ABCD-EFGH-IJKL-MNOP-QRST-UVWX". */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(15);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return formatRecoveryCode(out);
}

/** Uppercases, drops separators and maps look-alike digits so hand-typed codes still match. */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/8/g, "B")
    .replace(/[^A-Z2-7]/g, "");
}

export function formatRecoveryCode(code: string): string {
  return (normalizeRecoveryCode(code).match(/.{1,4}/g) ?? []).join("-");
}

export function isValidRecoveryCode(input: string): boolean {
  return normalizeRecoveryCode(input).length === RECOVERY_CODE_LENGTH;
}

async function pbkdf2Key(secret: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts the private key with the recovery code for server-side backup. */
export async function encryptBackup(
  privateKey: `0x${string}`,
  recoveryCode: string,
  iterations = BACKUP_ITERATIONS,
): Promise<WalletBackup> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await pbkdf2Key(`${normalizeRecoveryCode(recoveryCode)}:${iterations}`, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, fromHex(privateKey));
  return { v: 1, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) };
}

export class WrongRecoveryCodeError extends Error {
  constructor() {
    super("รหัสกู้คืนไม่ถูกต้อง");
  }
}

export async function decryptBackup(
  backup: WalletBackup,
  recoveryCode: string,
  iterations = BACKUP_ITERATIONS,
): Promise<`0x${string}`> {
  const key = await pbkdf2Key(`${normalizeRecoveryCode(recoveryCode)}:${iterations}`, fromBase64(backup.salt), iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(backup.iv) }, key, fromBase64(backup.ciphertext));
    return toHex(new Uint8Array(pt));
  } catch {
    throw new WrongRecoveryCodeError();
  }
}

/** Slow hash of the app PIN; only gates the signing UI on this device. */
export async function hashPin(pin: string, salt: Bytes, iterations = PIN_ITERATIONS): Promise<string> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 256);
  return toBase64(new Uint8Array(bits));
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

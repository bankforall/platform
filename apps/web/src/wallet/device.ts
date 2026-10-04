import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { WalletBackup } from "@bankforall/shared";
import { constantTimeEqual, fromBase64, hashPin, randomBytes, toBase64 } from "./crypto";
import { idb } from "./idb";

/**
 * The signing key lives only on this device, in IndexedDB, encrypted with a non-extractable
 * AES-GCM key (so script on another origin, or a copied IndexedDB file without the browser's
 * key store, cannot read it). A 6-digit PIN gates every signature.
 */

interface StoredWallet {
  address: `0x${string}`;
  iv: string;
  ciphertext: string;
}
interface StoredPin {
  salt: string;
  hash: string;
}
interface PinLock {
  failures: number;
  lockedUntil: number;
}

const K_DEVICE_KEY = "deviceKey";
const K_WALLET = "wallet";
const K_PIN = "pin";
const K_LOCK = "pinLock";
const K_PENDING_BACKUP = "pendingBackup";

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 5 * 60 * 1000;

async function deviceKey(): Promise<CryptoKey> {
  const existing = await idb.get<CryptoKey>(K_DEVICE_KEY);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idb.set(K_DEVICE_KEY, key);
  return key;
}

export async function storeLocalKey(privateKey: `0x${string}`): Promise<`0x${string}`> {
  const address = privateKeyToAccount(privateKey).address;
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deviceKey(),
    new TextEncoder().encode(privateKey),
  );
  const stored: StoredWallet = { address, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) };
  await idb.set(K_WALLET, stored);
  return address;
}

export async function localAddress(): Promise<`0x${string}` | null> {
  return (await idb.get<StoredWallet>(K_WALLET))?.address ?? null;
}

async function loadLocalKey(): Promise<`0x${string}`> {
  const stored = await idb.get<StoredWallet>(K_WALLET);
  if (!stored) throw new Error("ไม่พบกุญแจบนเครื่องนี้ กรุณากู้คืนบัญชี");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(stored.iv) },
    await deviceKey(),
    fromBase64(stored.ciphertext),
  );
  return new TextDecoder().decode(pt) as `0x${string}`;
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN ต้องเป็นตัวเลข 6 หลัก");
  const salt = randomBytes(16);
  await idb.set(K_PIN, { salt: toBase64(salt), hash: await hashPin(pin, salt) } satisfies StoredPin);
  await idb.del(K_LOCK);
}

export async function hasPin(): Promise<boolean> {
  return (await idb.get<StoredPin>(K_PIN)) !== undefined;
}

export class PinError extends Error {
  constructor(
    message: string,
    readonly lockedUntil: number | null,
    readonly attemptsLeft: number,
  ) {
    super(message);
  }
}

/** Verifies the PIN (with lock-out) and returns an account that can sign. */
export async function unlock(pin: string, now = Date.now()): Promise<PrivateKeyAccount> {
  const lock = (await idb.get<PinLock>(K_LOCK)) ?? { failures: 0, lockedUntil: 0 };
  if (lock.lockedUntil > now) {
    throw new PinError("ใส่ PIN ผิดหลายครั้ง กรุณารอสักครู่", lock.lockedUntil, 0);
  }
  const stored = await idb.get<StoredPin>(K_PIN);
  if (!stored) throw new PinError("ยังไม่ได้ตั้ง PIN บนเครื่องนี้", null, 0);

  const ok = constantTimeEqual(await hashPin(pin, fromBase64(stored.salt)), stored.hash);
  if (!ok) {
    const failures = (lock.lockedUntil && lock.lockedUntil <= now ? 0 : lock.failures) + 1;
    const lockedUntil = failures >= MAX_PIN_ATTEMPTS ? now + PIN_LOCK_MS : 0;
    await idb.set(K_LOCK, { failures: lockedUntil ? 0 : failures, lockedUntil } satisfies PinLock);
    throw new PinError(
      lockedUntil ? "ใส่ PIN ผิด 5 ครั้ง ระบบล็อก 5 นาที" : "PIN ไม่ถูกต้อง",
      lockedUntil || null,
      lockedUntil ? 0 : MAX_PIN_ATTEMPTS - failures,
    );
  }
  await idb.del(K_LOCK);
  return privateKeyToAccount(await loadLocalKey());
}

/** Wipes the key and PIN from this device (logout on a shared device, or before restore). */
export async function clearDevice(): Promise<void> {
  await idb.del(K_WALLET);
  await idb.del(K_PIN);
  await idb.del(K_LOCK);
  await idb.del(K_PENDING_BACKUP);
}

/**
 * Backup of a key created for a key rotation, kept on this device until the rotation executes and
 * it can be uploaded with `PUT /api/me/wallet`. `backup` is encrypted with the new recovery code and
 * `proof` is the wallet proof signature, so nothing here unlocks the key.
 */
export interface PendingBackup {
  address: `0x${string}`;
  proof: `0x${string}`;
  backup: WalletBackup;
}

export async function savePendingBackup(pending: PendingBackup): Promise<void> {
  await idb.set(K_PENDING_BACKUP, pending);
}

export async function pendingBackup(): Promise<PendingBackup | null> {
  return (await idb.get<PendingBackup>(K_PENDING_BACKUP)) ?? null;
}

export async function clearPendingBackup(): Promise<void> {
  await idb.del(K_PENDING_BACKUP);
}

export function newPrivateKey(): `0x${string}` {
  return generatePrivateKey();
}

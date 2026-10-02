import { beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  decryptBackup,
  encryptBackup,
  formatRecoveryCode,
  generateRecoveryCode,
  isValidRecoveryCode,
  normalizeRecoveryCode,
  WrongRecoveryCodeError,
} from "./crypto";
import { MAX_PIN_ATTEMPTS, PinError, clearDevice, localAddress, newPrivateKey, setPin, storeLocalKey, unlock } from "./device";

const FAST = 1_000; // iterations for tests; production uses BACKUP_ITERATIONS

describe("recovery code", () => {
  it("is 120 bits shown as 6 groups of 4 base32 characters", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/);
    expect(isValidRecoveryCode(code)).toBe(true);
    expect(new Set(Array.from({ length: 50 }, generateRecoveryCode)).size).toBe(50);
  });

  it("tolerates lowercase, spaces and look-alike digits", () => {
    expect(normalizeRecoveryCode("abcd efgh-0O1I 8B")).toBe("ABCDEFGHOOIIBB");
    expect(formatRecoveryCode("abcdefgh")).toBe("ABCD-EFGH");
    expect(isValidRecoveryCode("ABCD-EFGH")).toBe(false);
  });
});

describe("backup", () => {
  it("round-trips the private key with the recovery code", async () => {
    const pk = newPrivateKey();
    const code = generateRecoveryCode();
    const backup = await encryptBackup(pk, code, FAST);
    expect(backup.v).toBe(1);
    expect(backup.ciphertext).not.toContain(pk.slice(2, 10));
    expect(await decryptBackup(backup, code.toLowerCase().replace(/-/g, " "), FAST)).toBe(pk);
  });

  it("rejects a wrong recovery code", async () => {
    const backup = await encryptBackup(newPrivateKey(), generateRecoveryCode(), FAST);
    await expect(decryptBackup(backup, generateRecoveryCode(), FAST)).rejects.toBeInstanceOf(WrongRecoveryCodeError);
  });
});

describe("device key + PIN", () => {
  beforeEach(async () => {
    await clearDevice();
  });

  it("stores the key encrypted and unlocks it with the PIN", async () => {
    const pk = newPrivateKey();
    const address = await storeLocalKey(pk);
    expect(address).toBe(privateKeyToAccount(pk).address);
    expect(await localAddress()).toBe(address);
    await setPin("123456");
    const account = await unlock("123456");
    expect(account.address).toBe(address);
  });

  it("locks after too many wrong PINs", async () => {
    await storeLocalKey(newPrivateKey());
    await setPin("123456");
    const now = 1_000_000;
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      await expect(unlock("000000", now)).rejects.toMatchObject({ attemptsLeft: MAX_PIN_ATTEMPTS - i });
    }
    const err = (await unlock("000000", now).catch((e) => e)) as PinError;
    expect(err.lockedUntil).toBeGreaterThan(now);
    // even the right PIN is refused while locked
    await expect(unlock("123456", now + 1000)).rejects.toBeInstanceOf(PinError);
    // and works again after the lock expires
    expect((await unlock("123456", now + 6 * 60 * 1000)).address).toBe(await localAddress());
  });
});

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

export const RPC_URL = process.env.E2E_RPC_URL ?? "http://127.0.0.1:58545";
export const PIN = "482913";
const API_DIR = fileURLToPath(new URL("../../apps/api", import.meta.url));

export interface Actor {
  name: string;
  context: BrowserContext;
  page: Page;
  phone: string;
  nationalId: string;
  recoveryCode?: string;
}

/** 1×1 transparent PNG — enough for KYC and slip uploads. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
export const png = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });

export function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
}

/** Random valid Thai national ID (mod-11 checksum). */
export function thaiId(): string {
  const body = "1" + randomDigits(11);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (13 - i);
  return body + ((11 - (sum % 11)) % 10);
}

export async function newActor(browser: Browser, name: string): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`[${name}] pageerror`, e.message));
  return { name, context, page, phone: "08" + randomDigits(8), nationalId: thaiId() };
}

/**
 * page.goto that retries when the SPA shell stays empty — Vite can drop a module request
 * (ERR_NETWORK_CHANGED) while packages/shared/dist is being rebuilt in another terminal.
 */
export async function open(page: Page, path: string) {
  for (let attempt = 0; ; attempt++) {
    await page.goto(path);
    const rendered = await page
      .waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0, null, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (rendered || attempt >= 2) return;
  }
}

export async function devLogin(page: Page, name: string) {
  await open(page, "/login");
  await page.getByLabel("ชื่อที่แสดง").fill(name);
  await page.getByRole("button", { name: "เข้าสู่ระบบแบบทดสอบ" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function logout(page: Page) {
  await page.evaluate(() =>
    fetch("/api/auth/logout", { method: "POST", headers: { "x-requested-with": "bankforall" }, credentials: "include" }),
  );
}

/** Types a PIN on the on-screen pad (scoped to `root`, e.g. the confirmation dialog). */
export async function enterPin(root: Page | Locator, pin = PIN) {
  for (const d of pin) await root.getByRole("button", { name: d, exact: true }).click();
}

/**
 * Clicks a button that prepares an on-chain intent, then signs it with the PIN.
 * Mines a block first: anvil only mines on demand, so after idle minutes the latest block's
 * timestamp is stale and the API would derive an already-expired forward-request deadline from it.
 */
export async function act(page: Page, button: Locator) {
  await rpc("evm_mine");
  await button.click();
  await signIntent(page);
}

/** Confirms an intent in the bottom sheet with the PIN and waits for "บันทึกถาวรแล้ว". */
export async function signIntent(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "0", exact: true })).toBeVisible();
  await enterPin(dialog);
  await expect(dialog.getByText("บันทึกถาวรแล้ว", { exact: true })).toBeVisible({ timeout: 90_000 });
  await dialog.getByRole("button", { name: "เสร็จสิ้น" }).click();
  await expect(dialog).toBeHidden();
}

/** Full member onboarding through the UI; returns the recovery code shown during wallet setup. */
export async function onboard(a: Actor) {
  const { page } = a;
  await devLogin(page, a.name);
  await page.waitForURL("**/onboarding");

  // phone + OTP (dev SMS code is shown in the UI)
  await page.getByLabel("เบอร์มือถือ").fill(a.phone);
  await page.getByRole("button", { name: "ส่งรหัสยืนยัน" }).click();
  const devCode = (await page.getByTestId("dev-otp").locator("strong").textContent())!.trim();
  await page.getByLabel("รหัสยืนยัน").fill(devCode);
  await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();

  // PromptPay (pre-filled with the verified phone)
  await expect(page.getByRole("heading", { name: "บัญชีรับเงิน" })).toBeVisible();
  await expect(page.getByLabel(/พร้อมเพย์/)).toHaveValue(a.phone);
  await page.getByRole("button", { name: "บันทึก" }).click();

  // consent
  await expect(page.getByRole("heading", { name: "ข้อตกลงการใช้งาน" })).toBeVisible();
  await page.getByLabel(/บริษัทไม่ใช่นายวงและไม่ถือเงิน/).check();
  await page.getByLabel(/ยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล/).check();
  await page.getByRole("button", { name: "ยอมรับและดำเนินการต่อ" }).click();

  // wallet: PIN twice, recovery code, confirm one group
  await page.getByRole("button", { name: "เริ่มตั้งค่า" }).click();
  await enterPin(page);
  await expect(page.getByRole("heading", { name: "ยืนยัน PIN อีกครั้ง" })).toBeVisible();
  await enterPin(page);
  const codeEl = page.getByTestId("recovery-code");
  a.recoveryCode = (await codeEl.getAttribute("data-code"))!;
  expect(a.recoveryCode).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/);
  await page.getByRole("button", { name: "บันทึกรหัสแล้ว" }).click();
  const label = (await page.getByText(/พิมพ์รหัสชุดที่ \d/).textContent())!;
  const group = a.recoveryCode.split("-")[Number(label.match(/\d/)![0]) - 1]!;
  await page.getByLabel(/พิมพ์รหัสชุดที่/).fill(group);
  await page.getByRole("button", { name: "ยืนยันและเปิดใช้งาน" }).click();

  // KYC
  await expect(page.getByRole("heading", { name: "ยืนยันตัวตน", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("ชื่อ-นามสกุล (ตามบัตรประชาชน)").fill(`${a.name} ทดสอบ`);
  await page.getByLabel("เลขประจำตัวประชาชน 13 หลัก").fill(a.nationalId);
  await page.locator('input[type="file"]').nth(0).setInputFiles(png("id.png"));
  await page.locator('input[type="file"]').nth(1).setInputFiles(png("selfie.png"));
  await page.getByRole("button", { name: "ส่งข้อมูลยืนยันตัวตน" }).click();
  await expect(page.getByText("ส่งข้อมูลยืนยันตัวตนแล้ว")).toBeVisible();
}

export function promoteAdmin(lineUserId: string) {
  execFileSync("bash", ["-c", `set -a && . ./.env && set +a && npx tsx src/cli/promote-admin.ts "$0"`, lineUserId], {
    cwd: API_DIR,
    stdio: "pipe",
  });
}

async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export async function mine() {
  await rpc("evm_mine");
}

/** Moves chain time forward; the worker's keeper reacts on its next tick. */
export async function warp(seconds: number) {
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine");
}

/** Reloads `page` until `locator` is visible (state that only the worker/indexer can advance). */
export async function eventually(page: Page, locator: () => Locator, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await locator().isVisible().catch(() => false)) return;
    if (Date.now() > deadline) {
      await expect(locator()).toBeVisible({ timeout: 1 });
      return;
    }
    await page.waitForTimeout(2500);
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
}

import { expect, test } from "@playwright/test";
import {
  act,
  devLogin,
  enterPin,
  eventually,
  logout,
  mine,
  newActor,
  open,
  onboard,
  png,
  promoteAdmin,
  signIntent,
  warp,
  type Actor,
} from "./helpers";

const DAY = 86_400;
const run = Date.now().toString(36);

test.describe.serial("peer-share circle end to end", () => {
  let admin: Actor;
  let host: Actor;
  let alice: Actor;
  let bob: Actor;
  let circleUrl = "";
  let inviteCode = "";
  const circleName = `วงทดสอบ ${run}`;

  test.beforeAll(async ({ browser }) => {
    admin = await newActor(browser, `admin-${run}`);
    host = await newActor(browser, `host-${run}`);
    alice = await newActor(browser, `alice-${run}`);
    bob = await newActor(browser, `bob-${run}`);
  });
  test.afterAll(async () => {
    for (const a of [admin, host, alice, bob]) await a?.context.close();
  });

  test("members onboard through the UI", async () => {
    for (const a of [host, alice, bob]) await onboard(a);
  });

  test("admin approves the three KYC submissions", async () => {
    const { page } = admin;
    await devLogin(page, admin.name);
    promoteAdmin(`dev:${admin.name}`);
    await logout(page);
    await devLogin(page, admin.name);

    await open(page, "/admin");
    await expect(page.getByRole("heading", { name: "ตรวจสอบตัวตน (KYC)" })).toBeVisible();
    for (const a of [host, alice, bob]) {
      const card = page.locator("section").filter({ hasText: `${a.name} ทดสอบ` });
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: "อนุมัติ", exact: true }).click();
      await expect(card).toBeHidden();
    }
  });

  test("host creates a private 3-member Float circle", async () => {
    const { page } = host;
    await open(page, "/");
    await expect(page.getByText("ไม่มียอดค้างจ่าย")).toBeVisible();
    await open(page, "/circles/new");
    await page.getByLabel("ชื่อวง").fill(circleName);
    await page.getByLabel(/ประมูลดอกตาม \(Float\)/).check();
    await page.getByLabel("เงินต่องวด").fill("1000");
    await page.getByLabel(/จำนวนมือ/).fill("3");
    await expect(page.getByLabel(/วงส่วนตัว/)).toBeChecked();

    // preview: host takes round 1; with a 50-baht winning bid the last round pays 1,000 + 1,050
    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("คุณ (นายวง)");
    await expect(rows.nth(0)).toContainText("2,000");
    await expect(rows.nth(2)).toContainText("2,050");

    await act(page, page.getByRole("button", { name: "สร้างวง", exact: true }));
    await page.waitForURL(/\/circles\/[^/]+$/);
    circleUrl = new URL(page.url()).pathname;

    await eventually(page, () => page.getByTestId("invite-code"));
    inviteCode = (await page.getByTestId("invite-code").textContent())!.trim();
    expect(inviteCode.length).toBeGreaterThan(4);
  });

  test("alice and bob join with the invite code", async () => {
    for (const a of [alice, bob]) {
      const { page } = a;
      await open(page, `/join/${inviteCode}`);
      await expect(page.getByRole("heading", { name: circleName })).toBeVisible();
      await act(page, page.getByRole("button", { name: "เข้าร่วมวง", exact: true }));
      await page.waitForURL(`**${circleUrl}`);
    }
  });

  test("host starts the circle", async () => {
    const { page } = host;
    await open(page, circleUrl);
    await eventually(page, () => page.getByText("สมาชิกครบแล้ว เริ่มวงได้เลย งวดแรกจะเปิดทันที"));
    await act(page, page.getByRole("button", { name: "เริ่มวง", exact: true }));
    await eventually(page, () => page.getByText("กำลังเล่น"));
  });

  test("round 1: members pay the host by PromptPay and the host confirms", async () => {
    for (const a of [alice, bob]) {
      const { page } = a;
      await open(page, `${circleUrl}?tab=payment`);
      await eventually(page, () => page.getByText("ยอดที่ต้องโอนงวดนี้"));
      await expect(page.getByRole("img", { name: /QR พร้อมเพย์ 1,000 บาท/ })).toBeVisible();
      await mine();
      await page.locator("#slip-input").setInputFiles(png("slip.png"));
      await signIntent(page);
      // declared (waiting for the recipient) or already bank-verified
      await eventually(page, () => page.getByText("แจ้งโอนแล้ว รอผู้รับยืนยัน").or(page.getByText("ตรวจสลิปกับธนาคารแล้ว ✓")));
    }

    const { page } = host;
    await open(page, `${circleUrl}?tab=payment`);
    await eventually(page, () => page.getByText("งวดนี้คุณเป็นผู้รับเงินกองกลาง 🎉"));
    for (const a of [alice, bob]) {
      const row = () => page.locator("li").filter({ hasText: a.name });
      await eventually(page, () => row().getByText("แจ้งโอนแล้ว").or(row().getByText("ตรวจสลิปกับธนาคารแล้ว ✓")));
      // a bank-verified slip is already settled; a declared one needs the recipient's answer
      const confirm = row().getByRole("button", { name: "ยืนยันได้รับเงิน" });
      if (await confirm.isVisible()) {
        await expect(row().getByRole("button", { name: "ยังไม่ได้รับเงิน" })).toBeVisible();
        await mine();
        await confirm.click();
        // the sheet is rendered from the decoded call, not from server text
        await expect(page.getByRole("dialog").getByText(`ยืนยันว่าได้รับเงินจาก ${a.name}`)).toBeVisible();
        await signIntent(page);
      }
    }
    await eventually(page, () => page.getByText("ยืนยันแล้ว 2/2 คน"));
  });

  test("round 2: sealed bids decide the recipient", async () => {
    await warp(30 * DAY + 60);

    for (const [a, bid] of [
      [alice, "50"],
      [bob, "30"],
    ] as const) {
      const { page } = a;
      await open(page, `${circleUrl}?tab=bidding`);
      await eventually(page, () => page.getByRole("button", { name: "ยื่นซอง", exact: true }));
      await expect(page.getByRole("heading", { name: "งวดที่ 2" })).toBeVisible();
      await page.getByLabel("ดอกต่องวด (บาท)").fill(bid);
      await act(page, page.getByRole("button", { name: "ยื่นซอง", exact: true }));
      await expect(page.getByText("คุณยื่นซองแล้ว ✓", { exact: false })).toBeVisible();
    }

    // into the 1-day reveal window: the keeper opens both sealed bids with the stored secrets
    await warp(2 * DAY + 60);
    const { page } = host;
    await open(page, `${circleUrl}?tab=bidding`);
    const bidders = page.locator("li");
    await eventually(page, () => bidders.filter({ hasText: alice.name }).getByText("50 บาท"));
    await expect(bidders.filter({ hasText: bob.name }).getByText("30 บาท")).toBeVisible();

    // past the reveal window: the keeper closes bidding and the highest bid wins
    await warp(DAY + 60);
    await eventually(page, () => page.getByText(/ผู้ชนะ:/));
    await expect(page.getByText(/ผู้ชนะ:/)).toContainText(alice.name);
    await expect(page.getByText(/ผู้ชนะ:/)).toContainText("50");

    // bob now owes alice the principal; alice is the recipient
    await open(bob.page, `${circleUrl}?tab=payment`);
    await eventually(bob.page, () => bob.page.getByText("ยอดที่ต้องโอนงวดนี้"));
    await expect(bob.page.getByText(alice.name).first()).toBeVisible();
    await open(alice.page, `${circleUrl}?tab=payment`);
    await eventually(alice.page, () => alice.page.getByText("งวดนี้คุณเป็นผู้รับเงินกองกลาง 🎉"));
  });

  test("round 2: the recipient says a declared payment never arrived", async () => {
    await mine();
    await bob.page.locator("#slip-input").setInputFiles(png("slip.png"));
    await signIntent(bob.page);
    await eventually(bob.page, () => bob.page.getByText("แจ้งโอนแล้ว รอผู้รับยืนยัน").or(bob.page.getByText("ตรวจสลิปกับธนาคารแล้ว ✓")));
    if (await bob.page.getByText("ตรวจสลิปกับธนาคารแล้ว ✓").isVisible()) return; // bank-verified slips cannot be rejected

    const { page } = alice;
    const row = () => page.locator("li").filter({ hasText: bob.name });
    await eventually(page, () => row().getByRole("button", { name: "ยังไม่ได้รับเงิน" }));
    await mine();
    await row().getByRole("button", { name: "ยังไม่ได้รับเงิน" }).click();
    await expect(page.getByRole("dialog").getByText(`แจ้งว่ายังไม่ได้รับเงินจาก ${bob.name}`, { exact: true })).toBeVisible();
    await signIntent(page);

    // bob's payment is open again and he can declare before the default time
    await open(bob.page, `${circleUrl}?tab=payment`);
    await eventually(bob.page, () => bob.page.getByText("โอนแล้ว — อัปโหลดสลิป"));
  });

  test("evidence report opens", async () => {
    const { page, context } = host;
    await open(page, `${circleUrl}?tab=history`);
    const [report] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: "เปิดรายงานหลักฐาน" }).click(),
    ]);
    await report.waitForLoadState();
    await expect(report.locator("body")).toContainText(circleName);
    await expect(report.locator("body")).toContainText(alice.name);
    await report.close();
  });

  test("alice restores her wallet on a new device and can sign", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await devLogin(page, alice.name);
      await page.waitForURL("**/restore");
      await page.getByLabel("รหัสกู้คืน").fill(alice.recoveryCode!.toLowerCase().replaceAll("-", " "));
      await page.getByRole("button", { name: "กู้คืน", exact: true }).click();
      await expect(page.getByText("กู้คืนกุญแจสำเร็จ")).toBeVisible({ timeout: 30_000 });
      await enterPin(page);
      await expect(page.getByText("ใส่ PIN อีกครั้ง")).toBeVisible();
      await enterPin(page);
      await page.waitForURL((u) => u.pathname === "/");

      // sign a real action with the restored key: report a dispute on round 1
      await open(page, `${circleUrl}?tab=history`);
      await page.getByLabel("รายละเอียด").fill("ทดสอบการกู้คืนกุญแจบนเครื่องใหม่");
      await act(page, page.getByRole("button", { name: "ส่งเรื่อง" }));
    } finally {
      await context.close();
    }
  });
});

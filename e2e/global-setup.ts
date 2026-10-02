import { chromium, type FullConfig } from "@playwright/test";

/** Loads the app once so Vite finishes dependency optimisation (which forces a reload) before tests start. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const res = await fetch(`${baseURL}/api/config`).catch(() => null);
  if (!res?.ok) throw new Error(`API not reachable via ${baseURL}/api — start api, worker and web first`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const path of ["/login", "/onboarding", "/circles/new", "/admin"]) {
    await page.goto(baseURL + path);
    await page.waitForLoadState("networkidle");
  }
  await page.waitForTimeout(3000);
  await browser.close();
}

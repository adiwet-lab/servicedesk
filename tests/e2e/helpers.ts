import { expect, type Page } from "@playwright/test";

export async function loginAs(page: Page, displayName: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  const select = page.getByTestId("dev-user-select");
  const label = (await select.locator("option").allTextContents()).find((o) => o.startsWith(displayName));
  if (!label) throw new Error(`Demo user not found: ${displayName}`);
  await select.selectOption({ label });
  await page.getByTestId("dev-login-submit").click();
  await expect(page).not.toHaveURL(/\/login/);
  // On a cold dev server the first page compile can trigger a Fast Refresh reload that would
  // abort the test's next navigation; let the landing page settle first.
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

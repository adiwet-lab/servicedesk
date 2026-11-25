import { expect, type Page } from "@playwright/test";

export async function loginAs(page: Page, displayName: string, locale: "en" | "th" = "en") {
  await page.context().clearCookies();
  // The suite asserts English UI text; Thai (the default) is covered by i18n.spec.ts.
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: page.url().startsWith("http") ? new URL(page.url()).origin : "http://localhost:" + (process.env.E2E_PORT ?? 3000) }]);
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
  // A language saved on the user wins over the cookie: switch back if a previous test changed it.
  if ((await page.locator("html").getAttribute("lang")) !== locale) {
    await page.getByTestId(`lang-${locale}`).first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
}

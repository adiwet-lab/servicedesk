import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

const THAI = /[฀-๿]/;

test.describe("Thai / English", () => {
  test("the login page is Thai by default and can switch to English", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
    await expect(page.getByTestId("dev-login-submit")).toHaveText("เข้าสู่ระบบ");
    await page.getByTestId("lang-en").first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("dev-login-submit")).toHaveText("Sign in");
  });

  test("the chosen language is saved on the user and survives a new session", async ({ page }) => {
    await loginAs(page, "Mia Manager", "th");
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
    await page.getByTestId("lang-en").first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // New session with a Thai cookie: the saved preference (English) wins.
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "th", url: new URL(page.url()).origin }]);
    await page.goto("/login");
    const select = page.getByTestId("dev-user-select");
    const label = (await select.locator("option").allTextContents()).find((o) => o.startsWith("Mia Manager"))!;
    await select.selectOption({ label });
    await page.getByTestId("dev-login-submit").click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // Back to Thai, then leave the user in English for the rest of the suite.
    await page.getByTestId("lang-th").first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
    await page.getByTestId("lang-en").first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("Thai UI shows Thai category names, Buddhist-era dates and Thai notifications", async ({ page }) => {
    await loginAs(page, "Emma Employee", "th");
    await page.goto("/tickets/new");
    await expect(page.locator("#categoryId option", { hasText: "ฮาร์ดแวร์" })).toHaveCount(1);
    await expect(page.locator("#categoryId option", { hasText: "Hardware" })).toHaveCount(0);

    await page.goto("/tickets");
    const yearBE = String(new Date().getFullYear() + 543);
    await expect(page.locator("main")).toContainText(yearBE);

    await loginAs(page, "Ana Agent", "th");
    await page.goto("/notifications");
    const first = page.locator("main li").first();
    await expect(first).toBeVisible();
    await expect(first).toContainText(THAI);
  });

  test("knowledge articles are shown in the reader's language with a link to the other one", async ({ page }) => {
    await loginAs(page, "Emma Employee", "th");
    await page.goto("/help/KB-000001");
    await expect(page.getByTestId("kb-title")).toHaveText("วิธีเชื่อมต่อ VPN ของบริษัท");
    await page.getByTestId("kb-other-lang").click();
    await expect(page.getByTestId("kb-title")).toHaveText("How to connect to the company VPN");

    await loginAs(page, "Emma Employee", "en");
    await page.goto("/help/KB-000001");
    await expect(page.getByTestId("kb-title")).toHaveText("How to connect to the company VPN");
  });
});

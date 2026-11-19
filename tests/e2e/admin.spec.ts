import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("admin adds a subcategory and it appears in the create-ticket form", async ({ page }) => {
  const name = `E2E Sub ${Date.now()}`;
  await loginAs(page, "Alex Admin");
  await page.goto("/admin/config/categories");
  await page.getByTestId("crud-add").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Parent (main category)").selectOption({ label: "IT Request" });
  await dialog.getByLabel("Code").fill(`E2E-${Date.now()}`);
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByTestId("crud-save").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`↳ ${name}`)).toBeVisible();

  await loginAs(page, "Emma Employee");
  await page.goto("/tickets/new");
  await page.getByLabel("Main category").selectOption({ label: "IT Request" });
  await expect(page.getByLabel("Subcategory").locator("option", { hasText: name })).toHaveCount(1);
});

test("employees cannot reach the admin portal", async ({ page }) => {
  await loginAs(page, "Emma Employee");
  await page.goto("/admin/system/users");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a deactivated user is signed out immediately", async ({ browser }) => {
  const userCtx = await browser.newContext();
  const userPage = await userCtx.newPage();
  await loginAs(userPage, "Ethan Employee");
  await userPage.goto("/tickets");
  await expect(userPage.getByRole("heading", { name: "My Tickets" })).toBeVisible();

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await loginAs(admin, "Alex Admin");
  await admin.goto("/admin/system/users?q=ethan");
  await admin.getByRole("link", { name: "Ethan Employee" }).click();
  await admin.getByTestId("user-status").selectOption("INACTIVE");
  await admin.getByTestId("save-user").click();
  await expect(admin.getByText("Saved.")).toBeVisible();

  await userPage.goto("/tickets");
  await expect(userPage).toHaveURL(/\/login\?error=session_revoked/);
  await expect(userPage.getByText("Your session is no longer valid")).toBeVisible();

  // restore
  await admin.reload();
  await admin.getByTestId("user-status").selectOption("ACTIVE");
  await admin.getByTestId("save-user").click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await userCtx.close();
  await adminCtx.close();
});

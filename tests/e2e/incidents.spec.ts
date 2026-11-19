import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

const subject = `E2E store outage ${Date.now()}`;
let number = "";

test.describe.serial("major incident & branch impact", () => {
  test("employee reports an outage", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto("/tickets/new");
    await page.getByLabel("Main category").selectOption({ label: "IT Request" });
    await page.getByLabel("Subcategory").selectOption({ label: "Software Installation" });
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("Description").fill("Nobody at the store can log in to the ERP since 9am.");
    await page.getByTestId("submit-ticket").click();
    await expect(page).toHaveURL(/created=1/);
    number = (await page.getByTestId("ticket-number").textContent())!.trim();
    // Requesters see no impact controls.
    await expect(page.getByTestId("set-impact")).toHaveCount(0);
  });

  test("lead sets multi-branch impact and declares a major incident", async ({ page }) => {
    await loginAs(page, "Lee Lead");
    await page.goto(`/admin/tickets/${number}`);
    await page.getByTestId("set-impact").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("impact-scope").selectOption("MULTIPLE_BRANCHES");
    await dialog.getByLabel("Bangkok – Siam Store").check();
    await dialog.getByLabel("Chiang Mai Store").check();
    await dialog.getByLabel("Approx. affected users").fill("35");
    await dialog.getByTestId("save-impact").click();
    await expect(page.getByTestId("impact-value")).toHaveText("Multiple branches");

    await page.getByTestId("declare-major").click();
    await page.getByTestId("declare-message").fill("ERP login is failing at Siam and Chiang Mai stores. We are investigating.");
    await page.getByTestId("confirm-declare").click();
    await expect(page.getByTestId("major-badge")).toBeVisible();
    await expect(page.getByTestId("mi-status").first()).toHaveText("Investigating");
  });

  test("employee in an impacted branch sees the banner and reports being affected", async ({ page }) => {
    await loginAs(page, "Somchai Store");
    await page.goto("/dashboard");
    const banner = page.getByTestId("known-issues").locator("div.rounded-lg", { hasText: subject });
    await expect(banner).toContainText("We are investigating");
    await banner.getByTestId("affected-too").click();
    await expect(page).toHaveURL(/created=1/);
    await expect(page.getByTestId("incident-panel")).toContainText(number);
    await page.goto("/dashboard");
    await expect(page.getByTestId("known-issues").locator("div.rounded-lg", { hasText: subject })).toContainText("Your report:");
  });

  test("employee outside the impacted branches sees no banner", async ({ page }) => {
    await loginAs(page, "Mia Manager");
    await page.goto("/dashboard");
    await expect(page.getByText(`Known issue: ${subject}`)).toHaveCount(0);
  });

  test("lead posts an update, sees the dashboard, and resolves with cascade", async ({ page }) => {
    await loginAs(page, "Lee Lead");
    await page.goto("/admin/incidents");
    const row = page.getByTestId("incident-table").getByRole("row", { name: new RegExp(number) });
    await expect(row).toContainText("Multiple branches");
    await expect(row).toContainText("1"); // linked ticket from Somchai
    await row.getByRole("link", { name: number }).click();

    await page.getByTestId("update-status").selectOption("IDENTIFIED");
    await page.getByTestId("update-message").fill("Expired certificate on the ERP gateway identified.");
    await page.getByTestId("post-update").click();
    await expect(page.getByTestId("incident-updates")).toContainText("Expired certificate");
    await expect(page.getByTestId("mi-status").first()).toHaveText("Identified");

    await page.getByTestId("resolve-incident").click();
    await page.getByTestId("resolve-summary").fill("Certificate renewed; ERP login works again at all stores.");
    await page.getByTestId("confirm-resolve").click();
    await expect(page.getByTestId("resolve-result")).toContainText("Incident resolved");
    await expect(page.getByTestId("resolve-result")).toContainText("skipped"); // Somchai's report is still New — no workflow transition to Resolved
    await expect(page.getByTestId("mi-status").first()).toHaveText("Resolved");
  });

  test("banner disappears after resolution", async ({ page }) => {
    await loginAs(page, "Somchai Store");
    await page.goto("/dashboard");
    await expect(page.getByText(`Known issue: ${subject}`)).toHaveCount(0);
  });
});

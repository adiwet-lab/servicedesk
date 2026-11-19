import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

const subject = `E2E docking station ${Date.now()}`;
let number = "";

test.describe.serial("approval workflow", () => {
  test("employee creates a hardware request that needs manager approval", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto("/tickets/new");
    await page.getByLabel("Main category").selectOption({ label: "IT Request" });
    await page.getByLabel("Subcategory").selectOption({ label: "Hardware Request" });
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("Description").fill("I need a docking station for my second desk.");
    await page.getByTestId("submit-ticket").click();
    await expect(page).toHaveURL(/created=1/);
    number = (await page.getByTestId("ticket-number").textContent())!.trim();
    await expect(page.getByTestId("approval-status")).toHaveText("Pending");
    await expect(page.getByTestId("approval-card")).toContainText("Ethan Employee");
  });

  test("agent can only cancel while approval is pending", async ({ page }) => {
    await loginAs(page, "Ana Agent");
    await page.goto(`/admin/tickets?view=all&q=${encodeURIComponent(subject)}`);
    await expect(page.getByTestId("approval-badge")).toBeVisible();
    await page.goto(`/admin/tickets/${number}`);
    await page.getByTestId("change-status").click();
    await expect(page.getByRole("menuitem", { name: "In Progress", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Cancelled", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("manager approves from My Approvals", async ({ page }) => {
    await loginAs(page, "Ethan Employee");
    await page.goto("/approvals");
    const item = page.getByTestId("pending-approvals").locator("li", { hasText: subject });
    await item.getByTestId("approve").click();
    await page.getByTestId("decision-comment").fill("Approved — budget available.");
    await page.getByTestId("confirm-decision").click();
    await expect(page.getByTestId("decided-approvals")).toContainText(number);
    await expect(page.getByTestId("pending-approvals").locator("li", { hasText: subject })).toHaveCount(0);
  });

  test("agent can now work the ticket", async ({ page }) => {
    await loginAs(page, "Ana Agent");
    await page.goto(`/admin/tickets/${number}`);
    await expect(page.getByTestId("approval-status")).toHaveText("Approved");
    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.locator("dl").first()).toContainText("Ana Agent");
    await page.getByTestId("change-status").click();
    await page.getByRole("menuitem", { name: "In Progress", exact: true }).click();
    await page.getByTestId("confirm-status").click();
    await expect(page.getByTestId("ticket-number").locator("..")).toContainText("In Progress");
  });

  test("admin sees approval policies", async ({ page }) => {
    await loginAs(page, "Alex Admin");
    await page.goto("/admin/config/approvals");
    await expect(page.getByRole("cell", { name: "Hardware request approval", exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Hardware request approval/ })).toContainText("requester's manager");
  });
});

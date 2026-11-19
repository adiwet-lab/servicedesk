import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

const subject = `E2E install request ${Date.now()}`;
let number = "";

test.describe.serial("ticket lifecycle", () => {
  test("employee creates a ticket and sees it on the dashboard", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto("/tickets/new");
    await page.getByLabel("Main category").selectOption({ label: "IT Request" });
    await page.getByLabel("Subcategory").selectOption({ label: "Software Installation" });
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("Description").fill("Please install Visual Studio Code on my notebook.");
    await page.getByTestId("submit-ticket").click();
    await expect(page).toHaveURL(/\/tickets\/IT-\d{4}-\d{6}\?created=1/);
    number = (await page.getByTestId("ticket-number").textContent())!.trim();
    await expect(page.getByText(/was created and routed to/)).toContainText("IT Support");

    await page.goto("/dashboard");
    await expect(page.getByTestId("ticket-table")).toContainText(number);
    await page.goto(`/tickets?q=${encodeURIComponent(subject)}`);
    await expect(page.getByTestId("ticket-table")).toContainText(subject);
  });

  test("agent works the ticket through the controlled workflow", async ({ page }) => {
    await loginAs(page, "Ana Agent");
    await page.goto(`/admin/tickets/${number}`);
    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.locator("dl").first()).toContainText("Ana Agent");

    const change = async (status: string) => {
      await page.getByTestId("change-status").click();
      await page.getByRole("menuitem", { name: status, exact: true }).click();
    };
    await change("In Progress");
    await page.getByTestId("confirm-status").click();
    await expect(page.getByTestId("ticket-number").locator("..")).toContainText("In Progress");

    await change("Waiting for User");
    const reason = page.getByLabel("Waiting reason");
    await expect(reason).toHaveAttribute("required", "");
    await reason.fill("Which edition do you need?");
    await page.getByTestId("confirm-status").click();
    await expect(page.getByText("Which edition do you need?").first()).toBeVisible();

    await change("In Progress");
    await page.getByTestId("confirm-status").click();
    await change("Resolved");
    await page.getByLabel("Resolution summary").fill("Installed VS Code via Company Portal.");
    await page.getByTestId("confirm-status").click();
    await expect(page.getByText("Installed VS Code via Company Portal.").first()).toBeVisible();
    await expect(page.getByTestId("timeline")).toContainText("Resolved");
  });

  test("requester sees the resolution and can close the ticket", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto(`/tickets/${number}`);
    await expect(page.getByText("Installed VS Code via Company Portal.").first()).toBeVisible();
    await page.getByTestId("change-status").click();
    await page.getByRole("menuitem", { name: "Closed", exact: true }).click();
    await page.getByTestId("confirm-status").click();
    await expect(page.getByTestId("ticket-number").locator("..")).toContainText("Closed");
    await expect(page.getByTestId("change-status")).toHaveCount(0); // closed tickets are locked for the requester
  });

  test("other users cannot open the ticket", async ({ page }) => {
    await loginAs(page, "Fiona Fabrikam");
    await page.goto(`/tickets/${number}`);
    await expect(page.getByText("This page does not exist or you do not have access to it.")).toBeVisible();
    await loginAs(page, "Victor VendorA");
    await page.goto(`/admin/tickets/${number}`);
    await expect(page.getByText("This page does not exist or you do not have access to it.")).toBeVisible();
  });
});

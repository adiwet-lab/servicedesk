import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const subject = `E2E multi-team ${Date.now()}`;
let number = "";
let taskNumber = "";

async function changeTicketStatus(page: Page, status: string, fill?: { label: string; value: string }) {
  await page.getByTestId("change-status").click();
  await page.getByRole("menuitem", { name: status, exact: true }).click();
  if (fill) await page.getByLabel(fill.label).fill(fill.value);
  await page.getByTestId("confirm-status").click();
}

test.describe.serial("multi-team tasks", () => {
  test("requester logs a ticket", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto("/tickets/new");
    await page.getByLabel("Main category").selectOption({ label: "IT Request" });
    await page.getByLabel("Subcategory").selectOption({ label: "Software Installation" });
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("Description").fill("New starter needs a docking station and network port enabled.");
    await page.getByTestId("submit-ticket").click();
    await expect(page).toHaveURL(/created=1/);
    number = (await page.getByTestId("ticket-number").textContent())!.trim();
  });

  test("lead creates a required task for Infrastructure; resolution is blocked", async ({ page }) => {
    await loginAs(page, "Lee Lead");
    await page.goto(`/admin/tickets/${number}`);
    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.getByTestId("teams-card")).toContainText("Responsible agent: Lee Lead");

    await page.getByTestId("tab-tasks").click();
    await page.getByTestId("new-task").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Enable network port 5-12");
    await dialog.getByLabel("Team").selectOption({ label: "Infrastructure" });
    await dialog.getByTestId("create-task").click();
    await expect(page.getByTestId("task-drawer-title")).toHaveText("Enable network port 5-12");
    taskNumber = (await page.locator("text=/TSK-\\d{4}-\\d{6}/").first().textContent())!.trim();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("teams-card")).toContainText("Infrastructure");
    await expect(page.getByTestId("task-progress")).toContainText("required 0/1");

    await changeTicketStatus(page, "In Progress");
    await page.getByTestId("change-status").click();
    await page.getByRole("menuitem", { name: "Resolved", exact: true }).click();
    await expect(page.getByText("Required tasks still open:")).toBeVisible();
    await page.getByLabel("Resolution summary").fill("Delivered dock");
    await page.getByTestId("confirm-status").click();
    await expect(page.getByRole("dialog").getByText(/required task\(s\) are not completed/)).toBeVisible();
  });

  test("infrastructure lead picks up and completes the task from Team Tasks", async ({ page }) => {
    await loginAs(page, "Ivan Infra");
    await page.goto(`/admin/tasks?view=team&q=${taskNumber}`);
    await expect(page.getByTestId("tasks-table")).toContainText(taskNumber);
    await page.getByRole("link", { name: taskNumber }).click();
    await expect(page.getByTestId("task-drawer-title")).toHaveText("Enable network port 5-12");
    await page.getByTestId("task-assign-me").click();
    await expect(page.getByRole("dialog")).toContainText("Ivan Infra");
    await page.getByTestId("task-status-IN_PROGRESS").click();
    await page.getByTestId("task-status-confirm").click();
    await expect(page.getByRole("dialog").getByText("In Progress").first()).toBeVisible();
    await page.getByTestId("task-status-COMPLETED").click();
    await page.getByLabel("Reason", { exact: true }).fill("Port patched and enabled.");
    await page.getByTestId("task-status-confirm").click();
    await expect(page.getByTestId("task-history")).toContainText("Port patched and enabled.");
  });

  test("lead can now resolve; requester sees completed progress read-only", async ({ page }) => {
    await loginAs(page, "Lee Lead");
    await page.goto(`/admin/tickets/${number}`);
    await changeTicketStatus(page, "Resolved", { label: "Resolution summary", value: "Dock delivered and port enabled." });
    await expect(page.getByText("Dock delivered and port enabled.").first()).toBeVisible();

    await loginAs(page, "Emma Employee");
    await page.goto(`/tickets/${number}`);
    await page.getByTestId("tab-tasks").click();
    await expect(page.getByTestId("task-progress")).toContainText("1/1 completed");
    await page.getByTestId(`task-row-${taskNumber}`).click();
    await expect(page.getByTestId("task-drawer-title")).toBeVisible();
    await expect(page.getByTestId("task-status-COMPLETED")).toHaveCount(0);
    await expect(page.getByTestId("task-assign-me")).toHaveCount(0);
  });

  test("vendor users cannot open the ticket", async ({ page }) => {
    await loginAs(page, "Vera VendorB");
    await page.goto(`/admin/tickets/${number}`);
    await expect(page.getByText("This page does not exist or you do not have access to it.")).toBeVisible();
  });
});

import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

async function changeStatus(page: Page, status: string, reason?: string) {
  await page.getByTestId("change-status").click();
  await page.getByRole("menuitem", { name: status, exact: true }).click();
  if (reason) await page.getByLabel(/reason/i).first().fill(reason);
  await page.getByTestId("confirm-status").click();
}

test("admin edits SLA targets and business hours; runs the SLA check; manages escalation rules", async ({ page }) => {
  await loginAs(page, "Alex Admin");
  await page.goto("/admin/config/sla");
  await page.getByRole("link", { name: "Targets" }).first().click();
  await expect(page.getByRole("heading", { name: /SLA targets/ })).toBeVisible();
  const resp = page.getByTestId("resp-P3");
  const original = await resp.inputValue();
  await resp.fill("5");
  await page.getByTestId("save-targets").click();
  await expect(page.getByText("SLA targets saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("resp-P3")).toHaveValue("5");
  await page.getByTestId("resp-P3").fill(original);
  await page.getByTestId("save-targets").click();
  await expect(page.getByText("SLA targets saved.")).toBeVisible();

  await page.goto("/admin/config/business-hours");
  const fridayEnd = page.getByTestId("bh-5-end-0").first();
  const endBefore = await fridayEnd.inputValue();
  await fridayEnd.fill("16:00");
  await page.getByTestId("save-business-hours").first().click();
  await expect(page.getByText("Business hours saved.").first()).toBeVisible();
  await page.getByTestId("bh-5-end-0").first().fill(endBefore);
  await page.getByTestId("save-business-hours").first().click();
  await expect(page.getByText("Business hours saved.").first()).toBeVisible();

  await page.goto("/admin/config/sla");
  await page.getByTestId("run-sla").click();
  await expect(page.getByTestId("run-sla-result")).toContainText(/Checked:|Another instance/);

  await page.goto("/admin/config/escalations");
  await page.getByTestId("crud-add").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("SLA profile").selectOption({ label: "Standard SLA" });
  await dialog.getByLabel("Clock").selectOption("RESOLUTION");
  await dialog.getByLabel("At % of target elapsed").fill("180");
  await dialog.getByText("Enabled").click();
  await dialog.getByTestId("crud-save").click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole("row", { name: /180%/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Deactivate" }).click();
  await expect(row).toContainText("Inactive");
});

test("SLA card shows both clocks, pauses while waiting for the user and resumes", async ({ page }) => {
  await loginAs(page, "Emma Employee");
  await page.goto("/tickets/new");
  await page.getByLabel("Main category").selectOption({ label: "IT Request" });
  await page.getByLabel("Subcategory").selectOption({ label: "Software Installation" });
  await page.getByLabel("Subject").fill(`E2E SLA ${Date.now()}`);
  await page.getByLabel("Description").fill("Please install 7-Zip for log extraction.");
  await page.getByTestId("submit-ticket").click();
  await expect(page).toHaveURL(/created=1/);
  const number = (await page.getByTestId("ticket-number").textContent())!.trim();
  await expect(page.getByTestId("sla-clock-response")).toBeVisible();

  await loginAs(page, "Ana Agent");
  await page.goto(`/admin/tickets/${number}`);
  await page.getByRole("button", { name: "Assign to me" }).click();
  await expect(page.getByTestId("sla-clock-response")).toHaveAttribute("data-state", /MET|MET_LATE/);
  await expect(page.getByTestId("sla-clock-resolution")).toHaveAttribute("data-state", /ON_TRACK|WARNING|BREACHED/);

  await changeStatus(page, "Waiting for User", "Which version do you need?");
  await expect(page.getByTestId("sla-card")).toContainText("Clock paused");
  await expect(page.getByTestId("sla-clock-resolution")).toHaveAttribute("data-state", /PAUSED|BREACHED/);

  await changeStatus(page, "In Progress");
  await expect(page.getByTestId("sla-card")).not.toContainText("Clock paused");
  await page.getByText(/SLA events/).click();
  await expect(page.getByTestId("sla-events")).toContainText("Resolution Paused");
  await expect(page.getByTestId("sla-events")).toContainText("Resolution Resumed");
});

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("management dashboard: filters update the URL and figures; tabs keep filters", async ({ page }) => {
  await loginAs(page, "Mia Manager");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/dashboards\/management/);
  await expect(page.getByTestId("kpis")).toBeVisible();
  const totalBefore = Number(await page.getByTestId("kpi-Total Tickets").locator("p").nth(1).textContent());
  await page.getByTestId("filter-range").selectOption("365d");
  await page.getByTestId("filter-priority").selectOption({ label: "P3 Medium" });
  await page.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/range=365d/);
  await expect(page).toHaveURL(/priority=/);
  await expect(page.getByTestId("active-filters")).toContainText("P3 Medium");
  const totalAfter = Number(await page.getByTestId("kpi-Total Tickets").locator("p").nth(1).textContent());
  expect(totalAfter).toBeGreaterThan(0);
  expect(Number.isFinite(totalBefore)).toBe(true);
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await page.getByTestId("dashboard-tabs").getByRole("link", { name: "SLA" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboards\/sla\?.*priority=/);
  await expect(page.getByTestId("meter-Resolution compliance")).toBeVisible();
  await page.getByTestId("dashboard-tabs").getByRole("link", { name: "Ticket aging" }).click();
  await expect(page.getByTestId("aging-table")).toContainText("More than 14 days");
});

test("team lead: team dashboard workload drills down into a filtered ticket list", async ({ page }) => {
  await loginAs(page, "Lee Lead");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/dashboards\/team/);
  await expect(page.getByRole("heading", { name: /Team Dashboard — IT Support/ })).toBeVisible();
  const table = page.getByTestId("workload-table");
  await expect(table).toContainText("Ana Agent");
  await table.getByRole("link", { name: "Ana Agent" }).click();
  await expect(page).toHaveURL(/\/admin\/tickets\?view=all.*agent=/);
  await expect(page.getByTestId("drill-filters")).toContainText("Agent: Ana Agent");
});

test("agent: My work dashboard", async ({ page }) => {
  await loginAs(page, "Ana Agent");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/dashboards\/agent/);
  await expect(page.getByTestId("my-kpis")).toContainText("Assigned to me");
  await page.goto("/admin/dashboards/management");
  await expect(page.getByText("This page does not exist or you do not have access to it.")).toBeVisible();
});

test("reports: preview and CSV export", async ({ page }) => {
  await loginAs(page, "Alex Admin");
  await page.goto("/admin/reports?range=365d");
  await expect(page.getByTestId("report-preview").locator("tbody tr").first()).toBeVisible();
  await page.getByTestId("report-teams").click();
  await expect(page.getByTestId("report-preview")).toContainText("IT Support");
  await page.getByTestId("report-tickets").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
  expect(download.suggestedFilename()).toMatch(/^servicedesk-tickets-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv.replace(/^﻿/, "").split("\r\n")[0]).toMatch(/^Ticket,Subject,Category,Subcategory,Requester/);
  expect(csv.split("\r\n").length).toBeGreaterThan(2);
});

test("employees cannot reach dashboards or the export API", async ({ page }) => {
  await loginAs(page, "Emma Employee");
  await page.goto("/admin/dashboards/sla");
  await expect(page).toHaveURL(/\/dashboard$/);
  const res = await page.request.get("/api/reports/tickets");
  expect(res.status()).toBe(403);
});

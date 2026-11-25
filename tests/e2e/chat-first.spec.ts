import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a3b1b6c30000000049454e44ae426082", "hex");

async function newUser(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await loginAs(page, name);
  return page;
}

test.describe.serial("chat-first service", () => {
  const detail = `Wi-Fi keeps dropping on floor 5 ${Date.now()}`;
  let number = "";

  test("employee reports a new case through the guided chat and follows it up", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto("/dashboard");
    await page.getByTestId("dashboard-report").click();
    await expect(page.getByTestId("chat-start")).toBeVisible();
    await page.getByTestId("chat-categories").getByRole("button", { name: "Network" }).click();
    await page.getByTestId("chat-subcategories").getByRole("button", { name: "Wi-Fi" }).click();
    await page.getByTestId("chat-branches").getByRole("button").first().click();
    await page.getByTestId("chat-start-input").fill(`${detail}\nIt reconnects after a minute.`);
    await page.getByTestId("chat-start-file").setInputFiles({ name: "wifi.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("chat-start-send").click();
    await expect(page).toHaveURL(/\/chat\?t=IT-\d{4}-\d{6}&created=1/);
    number = new URL(page.url()).searchParams.get("t")!;
    await expect(page.getByTestId("bot-created")).toContainText(number);
    await expect(page.getByTestId("case-subject")).toHaveText(detail);
    await expect(page.getByTestId("chat-image")).toBeVisible();

    // Follow up: the open case is offered
    await page.goto("/chat?follow=1");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("follow-up-list")).toContainText(number);
    await page.getByTestId("follow-up-list").getByRole("link", { name: new RegExp(number) }).click();
    await expect(page).toHaveURL(new RegExp(`t=${number}`));
    await expect(page.getByTestId("case-header")).toContainText(number);
  });

  test("an agent of another team claims it from the shared queue; replies reach the employee live; the employee closes it in chat", async ({ browser }) => {
    const emma = await newUser(browser, "Emma Employee");
    const ana = await newUser(browser, "Ana Agent");
    await emma.goto(`/chat?t=${number}`);
    await emma.waitForLoadState("networkidle");

    await ana.goto("/admin/chat");
    await ana.waitForLoadState("networkidle");
    await ana.getByTestId("queue-view-unclaimed").click();
    await expect(ana.getByTestId("queue-list")).toContainText(number);
    await ana.getByTestId("queue-list").getByText(number).click();
    await expect(ana.getByTestId("case-header")).toContainText("Waiting for an IT agent");
    await ana.getByTestId("claim-chat").click();
    await expect(ana.getByTestId("case-header")).toContainText("Handled by Ana Agent");
    await expect(ana.getByTestId("claim-chat")).toHaveCount(0);

    await ana.getByTestId("chat-input").fill("Thanks — I am on my way to floor 5.");
    await ana.getByTestId("chat-send").click();
    await expect(emma.getByTestId("chat-log")).toContainText("I am on my way to floor 5", { timeout: 15_000 });

    // Agent ends the conversation with the workflow statuses
    await ana.getByTestId("change-status").click();
    await ana.getByRole("menuitem", { name: "In Progress", exact: true }).click();
    await ana.getByTestId("confirm-status").click();
    await expect(ana.getByTestId("case-header")).toContainText("In Progress");
    await ana.getByTestId("change-status").click();
    await ana.getByRole("menuitem", { name: "Resolved", exact: true }).click();
    await ana.locator("#resolutionSummary").fill("Replaced the access point on floor 5.");
    await ana.getByTestId("confirm-status").click();
    await expect(ana.getByTestId("case-header")).toContainText("Resolved");

    await emma.reload();
    await expect(emma.getByTestId("bot-resolved")).toBeVisible();
    await emma.getByTestId("status-buttons").getByRole("button", { name: "Closed" }).click();
    await emma.getByTestId("confirm-status").click();
    await expect(emma.getByTestId("case-header")).toContainText("Closed");
    await emma.goto("/chat?follow=1");
    await expect(emma.getByTestId("chat-start")).not.toContainText(number);
  });

  test("staff save a personal default filter for the console", async ({ page }) => {
    await loginAs(page, "Lee Lead");
    await page.goto("/admin/chat");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("queue-filter-toggle").click();
    const panel = page.getByTestId("queue-filter");
    await panel.getByRole("button", { name: "Clear" }).click();
    await panel.getByTestId("filter-categories").getByLabel("Network", { exact: true }).check();
    await page.getByTestId("queue-filter-save").click();
    await expect(page.getByTestId("queue-filter-msg")).toBeVisible();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("queue-filter-toggle")).toHaveText(/Filter \(1\)/);
    // restore the default
    await page.getByTestId("queue-filter-toggle").click();
    await panel.getByRole("button", { name: "Clear" }).click();
    await page.getByTestId("queue-filter-save").click();
    await expect(page.getByTestId("queue-filter-msg")).toBeVisible();
    await expect(page.getByTestId("queue-filter-toggle")).toHaveText(/^\s*Filter\s*$/);
  });

  test("vendor staff only see a chat once it is assigned to their team", async ({ browser }) => {
    const emma = await newUser(browser, "Emma Employee");
    await emma.goto("/chat?new=1");
    await emma.getByTestId("chat-categories").getByRole("button", { name: "Network" }).click();
    await emma.getByTestId("chat-subcategories").getByRole("button", { name: "Firewall" }).click();
    await emma.getByTestId("chat-branches").getByRole("button").first().click();
    await emma.getByTestId("chat-start-input").fill(`Branch firewall blocks the POS update ${Date.now()}`);
    await emma.getByTestId("chat-start-send").click();
    await expect(emma).toHaveURL(/created=1/);
    const n = new URL(emma.url()).searchParams.get("t")!;

    const victor = await newUser(browser, "Victor VendorA");
    await victor.goto(`/admin/tickets/${n}`);
    await expect(victor.getByText("This page does not exist or you do not have access to it.")).toBeVisible();

    const admin = await newUser(browser, "Alex Admin");
    await admin.goto(`/admin/chat?t=${n}`);
    await admin.getByTestId("assign-button").click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Support team").selectOption({ label: "Vendor A – Network MSP" });
    await dialog.getByLabel("Transfer reason").fill("Branch firewall is managed by the MSP");
    await dialog.getByRole("button", { name: "Transfer" }).click();
    await expect(dialog).toBeHidden();

    await victor.goto(`/admin/tickets/${n}`);
    await expect(victor.getByTestId("ticket-number")).toHaveText(n);
    await victor.goto("/admin/chat");
    await expect(victor.getByTestId("inbox-list")).toContainText(n);
  });
});

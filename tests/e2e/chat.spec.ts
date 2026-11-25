import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64",
);

async function userPage(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, name);
  return page;
}
const live = (p: Page) => expect(p.getByTestId("live-indicator")).toHaveAttribute("data-status", "live", { timeout: 15_000 });

test("realtime chat between requester and agent, internal notes, attachments, unread badges and search", async ({ browser }) => {
  test.setTimeout(120_000);
  const subject = `E2E chat ${Date.now()}`;
  const emma = await userPage(browser, "Emma Employee");
  await emma.goto("/tickets/new");
  await emma.getByLabel("Main category").selectOption({ label: "IT Request" });
  await emma.getByLabel("Subcategory").selectOption({ label: "Software Installation" });
  await emma.getByLabel("Subject").fill(subject);
  await emma.getByLabel("Description").fill("Need Adobe Acrobat Pro for contract editing.");
  await emma.getByTestId("submit-ticket").click();
  await expect(emma).toHaveURL(/created=1/);
  const number = (await emma.getByTestId("ticket-number").textContent())!.trim();

  const ana = await userPage(browser, "Ana Agent");
  await ana.goto(`/admin/tickets/${number}?tab=chat`);
  await emma.goto(`/tickets/${number}?tab=chat`);
  await live(ana);
  await live(emma);

  // Requester → agent, live without reload
  await emma.getByTestId("chat-input").fill("Is a Standard licence enough?");
  await emma.getByTestId("chat-send").click();
  await expect(ana.getByTestId("chat-log")).toContainText("Is a Standard licence enough?", { timeout: 10_000 });

  // Internal note: staff only
  await ana.getByTestId("chat-type-internal").click();
  await ana.getByTestId("chat-input").fill("Check licence pool before replying");
  await ana.getByTestId("chat-send").click();
  await expect(ana.locator('[data-testid=chat-message][data-type=INTERNAL]')).toContainText("Check licence pool");

  // Requester leaves the ticket; agent replies with an image → bell + Messages badge update live
  await emma.goto("/dashboard");
  await live(emma);
  // The badge caps its text at "99+"; the exact count is in data-count.
  const bellCount = async () => Number((await emma.getByTestId("bell-count").getAttribute("data-count", { timeout: 1000 }).catch(() => "0")) || 0);
  const bellBefore = await bellCount();
  // Unread conversations from earlier runs may exist; compare against this run's baseline.
  const msgCount = async () => Number((await emma.getByTestId("nav-messages-badge").textContent({ timeout: 1000 }).catch(() => "0")) || 0);
  const msgBefore = await msgCount();
  await ana.getByTestId("chat-type-public").click();
  await ana.getByTestId("chat-input").fill("Pro is required for editing — licence assigned.");
  await ana.getByTestId("chat-file").setInputFiles({ name: "licence.png", mimeType: "image/png", buffer: PNG });
  await ana.getByTestId("chat-send").click();
  await expect.poll(msgCount, { timeout: 10_000 }).toBeGreaterThan(msgBefore);
  await expect(emma.getByTestId("toast").first()).toContainText(number);
  await expect.poll(bellCount).toBeGreaterThan(bellBefore);

  // The chat page lists the conversation (Phase 9: replaces the Messages inbox)
  await emma.goto("/chat");
  await expect(emma.getByTestId("chat-list")).toContainText(number);
  await emma.getByTestId("chat-list").getByText(subject).click();

  // Opening the chat: reply + image visible, internal note never visible, unread cleared
  await expect(emma.getByTestId("chat-log")).toContainText("licence assigned");
  await expect(emma.getByTestId("chat-image")).toBeVisible();
  await expect(emma.getByTestId("chat-log")).not.toContainText("Check licence pool");
  await expect.poll(msgCount, { timeout: 10_000 }).toBe(msgBefore);
  await emma.reload();
  await expect(emma.getByTestId("chat-log")).not.toContainText("Check licence pool");

  // Read receipt reaches the agent live
  await expect(ana.getByTestId("seen-by").last()).toContainText("Emma Employee", { timeout: 10_000 });

  // Search within the conversation
  await ana.getByTestId("chat-search").fill("licence pool");
  await ana.getByRole("button", { name: "Search", exact: true }).click();
  await expect(ana.getByTestId("chat-search-count")).toContainText("1 message");
  await emma.getByTestId("chat-search").fill("licence pool");
  await emma.getByRole("button", { name: "Search", exact: true }).click();
  await expect(emma.getByTestId("chat-search-count")).toContainText("0 message");
});

import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

const word = `quokkasync${Date.now().toString(36)}`; // unique search term
const subject = `Teams ${word} keeps crashing`;
let number = "";
let kbNumber = "";

test.describe.serial("knowledge base", () => {
  test("employee raises a ticket, agent resolves it", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto("/tickets/new");
    await page.getByLabel("Main category").selectOption({ label: "IT Request" });
    await page.getByLabel("Subcategory").selectOption({ label: "Software Installation" });
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("Description").fill("Microsoft Teams closes itself a few seconds after start.");
    await page.getByTestId("submit-ticket").click();
    await expect(page).toHaveURL(/created=1/);
    number = (await page.getByTestId("ticket-number").textContent())!.trim();

    await loginAs(page, "Ana Agent");
    await page.goto(`/admin/tickets/${number}`);
    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.locator("dl").first()).toContainText("Ana Agent");
    await expect(page.getByTestId("kb-from-ticket")).toHaveCount(0); // not resolved yet
    for (const s of ["In Progress", "Resolved"]) {
      await page.getByTestId("change-status").click();
      await page.getByRole("menuitem", { name: s, exact: true }).click();
      if (s === "Resolved") await page.getByLabel("Resolution summary").fill("Cleared the Teams cache folder and restarted Teams.");
      await page.getByTestId("confirm-status").click();
      await expect(page.getByTestId("ticket-number").locator("..")).toContainText(s);
    }
  });

  test("agent converts the resolved ticket into a draft article", async ({ page }) => {
    await loginAs(page, "Ana Agent");
    await page.goto(`/admin/tickets/${number}`);
    await page.getByTestId("kb-from-ticket").click();
    await expect(page).toHaveURL(/\/admin\/kb\/KB-\d{6}\?fromTicket=1/);
    kbNumber = (await page.getByTestId("kb-number").textContent())!.trim();
    await expect(page.getByTestId("kb-status")).toHaveText("Draft");
    await expect(page.getByLabel("Article body")).toHaveValue(/Cleared the Teams cache/);
    await page.getByTestId("kb-visibility").selectOption("EMPLOYEES");
    await page.getByLabel("Summary").fill(`Fix for Teams ${word} crashing on start.`);
    await page.getByTestId("kb-preview-tab").click();
    await expect(page.getByTestId("kb-body")).toContainText("Symptoms");
    await page.getByTestId("kb-save").click();
    await expect(page.getByText("Article saved")).toBeVisible();
    await expect(page.getByTestId("kb-published")).toHaveCount(0); // agents cannot publish
  });

  test("employee cannot see the draft", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto(`/help?q=${word}`);
    await expect(page.getByText("0 result(s)")).toBeVisible();
  });

  test("lead publishes the article", async ({ page }) => {
    await loginAs(page, "Lee Lead");
    await page.goto(`/admin/kb/${kbNumber}`);
    await page.getByTestId("kb-published").click();
    await expect(page.getByTestId("kb-status")).toHaveText("Published");
  });

  test("employee finds it in the Help Center, rates it, and gets it as a suggestion", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto("/help");
    await page.getByTestId("kb-search").fill(word);
    await page.getByTestId("kb-search").press("Enter");
    await page.getByTestId("kb-results").getByRole("link", { name: subject }).click();
    await expect(page.getByTestId("kb-title")).toHaveText(subject);
    await expect(page.getByTestId("kb-body")).toContainText("Cleared the Teams cache folder");
    await page.getByTestId("kb-helpful-yes").click();
    await expect(page.getByText("Thanks for your feedback!")).toBeVisible();

    await page.goto("/tickets/new");
    await page.getByLabel("Subject").fill(`teams ${word} crash again`);
    const suggestions = page.getByTestId("kb-suggestions");
    await expect(suggestions).toContainText(subject);
    await suggestions.getByTestId("kb-solved").first().click();
    await expect(page).toHaveURL(/\/help\/KB-\d{6}\?solved=1/);
    await expect(page.getByText("No ticket was created.")).toBeVisible();
  });

  test("Thai search finds the seeded password article", async ({ page }) => {
    await loginAs(page, "Emma Employee");
    await page.goto(`/help?q=${encodeURIComponent("รหัสผ่าน")}`);
    await expect(page.getByTestId("kb-results")).toContainText("How do I reset my password?");
    await expect(page.getByTestId("kb-results")).not.toContainText("POS terminal frozen"); // support-only
  });
});

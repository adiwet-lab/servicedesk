import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.describe.serial("integrations", () => {
  test("integrations page shows the status of each integration", async ({ page }) => {
    await loginAs(page, "Alex Admin");
    await page.goto("/admin/integrations");
    await expect(page.getByTestId("int-graph")).toContainText("Microsoft Graph");
    await expect(page.getByTestId("graph-status")).toBeVisible();
    await expect(page.getByTestId("int-teams")).toContainText("IT Support");
    await expect(page.getByTestId("asset-status")).toHaveText("Demo data");
    await page.getByTestId("test-asset").click();
    await expect(page.getByTestId("asset-test-result")).toContainText("Toshiba TCx 810");
  });

  test("admin creates a Power BI token (shown once) and reads the tickets feed", async ({ page }) => {
    await loginAs(page, "Alex Admin");
    await page.goto("/admin/integrations");
    const name = `E2E Power BI ${Date.now()}`;
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByTestId("create-token").click();
    const token = (await page.getByTestId("new-token").textContent())!.trim();
    expect(token).toMatch(/^sdbi_/);
    await expect(page.getByTestId("token-table")).toContainText(name);

    const anon = await page.request.get("/api/bi/v1/tickets", { headers: { Cookie: "" } });
    expect(anon.status()).toBe(401);
    const res = await page.request.get("/api/bi/v1/tickets?$top=5", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.value.length).toBeGreaterThan(0);
    expect(body.value[0]).toHaveProperty("number");
    expect(body.value[0]).not.toHaveProperty("description");

    // Reloading never shows the token again; revoke it.
    await page.reload();
    await expect(page.getByTestId("new-token")).toHaveCount(0);
    await page.getByTestId("token-table").getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByTestId("token-table").getByRole("row", { name: new RegExp(name) })).toContainText("Revoked");
    expect((await page.request.get("/api/bi/v1/tickets", { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
  });

  test("employee checks an asset tag on the create form (personal details hidden)", async ({ page }) => {
    await loginAs(page, "Somchai Store");
    await page.goto("/tickets/new");
    await page.getByLabel("Related asset").fill("POS-BKK01-03");
    await page.getByTestId("asset-check").click();
    await expect(page.getByTestId("asset-check-result")).toContainText("Toshiba TCx 810");
  });

  test("non-admins cannot open the integrations page", async ({ page }) => {
    await loginAs(page, "Lee Lead");
    await page.goto("/admin/integrations");
    await expect(page.getByText("This page does not exist or you do not have access to it.")).toBeVisible();
  });
});

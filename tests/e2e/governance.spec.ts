import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.describe("governance", () => {
  test("access review page and CSV export", async ({ page }) => {
    await loginAs(page, "Alex Admin");
    await page.goto("/admin/system/access-review");
    await expect(page.getByTestId("ar-privileged")).toContainText("Sam Super");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("access-review-csv").click()]);
    expect(dl.suggestedFilename()).toMatch(/^access-review-\d{4}-\d{2}-\d{2}\.csv$/);
    const buf = await (await dl.createReadStream()).toArray();
    const text = Buffer.concat(buf).toString("utf8");
    expect(text.startsWith("﻿Section,")).toBe(true); // exactly one BOM
    expect(text).toContain("Privileged");
  });

  test("audit log CSV and NDJSON export with the current filters", async ({ page }) => {
    await loginAs(page, "Alex Admin");
    await page.goto("/admin/system/audit?entity=Ticket");
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("audit-export-csv").click()]);
    expect(csv.suggestedFilename()).toMatch(/^audit-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
    const text = Buffer.concat(await (await csv.createReadStream()).toArray()).toString("utf8");
    expect(text.split("\r\n")[0]).toBe("﻿id,createdAt,action,entityType,entityId,actorId,actorEmail,ticketId,ticketNumber,ipAddress,userAgent,oldValue,newValue");
    const lines = text.trimEnd().split("\r\n").slice(1);
    expect(lines.length).toBeGreaterThan(0);
    const res = await page.request.get("/api/audit/export?format=ndjson&entity=Ticket");
    expect(res.headers()["content-type"]).toContain("application/x-ndjson");
    const recs = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(recs.every((r) => r.entityType === "Ticket")).toBe(true);
    // The export itself is audited.
    await page.goto("/admin/system/audit?action=AUDIT_EXPORTED");
    await expect(page.getByRole("table")).toContainText("AUDIT_EXPORTED");
  });

  test("non-admins cannot export", async ({ page }) => {
    await loginAs(page, "Lee Lead");
    expect((await page.request.get("/api/audit/export")).status()).toBe(403);
    expect((await page.request.get("/api/admin/access-review")).status()).toBe(403);
  });
});

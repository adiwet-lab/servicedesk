import { test as setup } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * A cold `next dev` server compiles each route on first request and may trigger a
 * Fast Refresh full reload in an open page, aborting whatever navigation a test starts
 * next. Visiting the main routes once (and tolerating aborts) makes the suite deterministic.
 */
setup("warm up dev server routes", async ({ page }) => {
  setup.setTimeout(240_000);
  const visit = async (path: string) => {
    for (let i = 0; i < 3; i++) {
      try { await page.goto(path); await page.waitForLoadState("networkidle"); return; } catch { await page.waitForTimeout(1000); }
    }
  };
  await loginAs(page, "Emma Employee").catch(() => undefined);
  for (const p of ["/dashboard", "/tickets/new", "/tickets", "/help", "/approvals", "/notifications"]) await visit(p);
  await loginAs(page, "Alex Admin").catch(() => undefined);
  for (const p of ["/admin/tickets?view=all", "/admin/kb", "/admin/incidents", "/admin/dashboards/management", "/admin/tasks?view=team", "/admin/config/approvals"]) await visit(p);
});

import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("pages carry a per-request nonce CSP that matches every script", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to (execute|load)/i.test(m.text())) violations.push(m.text()); });
  await loginAs(page, "Emma Employee");
  const res = await page.goto("/dashboard");
  const csp = res!.headers()["content-security-policy"]!;
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(/script-src[^;]*'unsafe-inline'/.test(csp)).toBe(false);
  expect(res!.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  // Every script in the server-rendered HTML carries the nonce of its own response
  // (chunks loaded later are trusted through 'strict-dynamic').
  const again = await page.request.get("/dashboard");
  const html = await again.text();
  const fresh = /'nonce-([^']+)'/.exec(again.headers()["content-security-policy"]!)![1];
  expect(fresh).not.toBe(nonce); // fresh per request
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  expect(tags.every((t) => t.includes(`nonce="${fresh}"`))).toBe(true);
  expect(violations).toEqual([]);
});

import { test, expect } from "@playwright/test";

// Presentation regression only. The separate E2E suite uses real APIs and storage.
test("dashboard tables remain scrollable inside a mobile viewport", async ({
  page,
}) => {
  const data: Record<string, unknown> = {
    "auth/me": { displayName: "Layout reviewer", email: "layout@example.test" },
    organizations: [{ id: "layout-org", name: "Orbit AI", role: "OWNER" }],
    "dashboard/overview": {
      latestRunId: "layout-run",
      totals: [
        {
          currency: "USD",
          audited_amount: "1840.00",
          potential_underbilling: "160.00",
          potential_overbilling: "0.00",
          components: 1,
          complete_components: 1,
        },
      ],
      counts: { open_findings: 1, confirmed_findings: 0 },
      imports: { last_import: "2026-11-01T09:00:00Z" },
      connections: [],
    },
    "dashboard/reconciliation-history": [
      {
        id: "layout-run",
        period_start: "2026-10-01T00:00:00Z",
        period_end: "2026-11-01T00:00:00Z",
        status: "COMPLETED",
      },
    ],
    "dashboard/exception-summary": [
      { finding_type: "MISSING_PROVIDER_USAGE", count: 1 },
    ],
  };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/v1/",
      "",
    );
    expect(path in data, `Unexpected API request: ${path}`).toBe(true);
    await route.fulfill({ json: data[path] });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard");
  await expect(page.getByText("USD 1,840.00", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "2026-10-01T00:00:00Z" }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/layout-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("link", { name: "Findings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({ path: ".local/layout-mobile.png", fullPage: true });
  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth)
      .map((el) => ({
        tag: el.tagName,
        class: el.className,
        right: el.getBoundingClientRect().right,
      }))
      .slice(0, 15),
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    JSON.stringify(overflow),
  ).toBe(390);
  const table = page.locator(".table-wrap").first();
  expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: ".local/layout-mobile.png", fullPage: true });
});

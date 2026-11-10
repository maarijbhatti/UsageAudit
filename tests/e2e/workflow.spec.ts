import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("register → organization → import → audit → review → report; tenant isolation", async ({
  page,
  browser,
}) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Browser Analyst");
  await page
    .getByLabel("Work email")
    .fill(`browser-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("BrowserTestPassword!23");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/onboarding/);
  await page.getByLabel("Organization name").fill("Browser audit organization");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const source =
    "eventId,sourceCustomerId,metricKey,quantity,unit,occurredAt,billable\ne1,acme,requests,100000,request,2026-10-15T00:00:00Z,true\n";
  const upload = async (type: string, csv: string) => {
    await page.goto("/imports");
    await page
      .getByRole("combobox", { name: "Import type", exact: true })
      .selectOption(type);
    await page.getByLabel("CSV file", { exact: true }).setInputFiles({
      name: type + ".csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Upload & preview" }).click();
    await page
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(page).toHaveURL(/imports\/[0-9a-f-]+/);
    await expect(
      page.getByRole("link", { name: "Continue to reconciliation" }),
    ).toBeVisible();
    return page.url().split("/").pop()!;
  };
  const sourceId = await upload("APPLICATION_USAGE", source);
  const duplicate = await upload("APPLICATION_USAGE", source);
  const authHeaders = async (p: Page) =>
    p.evaluate(() => ({
      "x-organization-id":
        localStorage.getItem("usageaudit.organization") ?? "",
      "x-csrf-token":
        document.cookie
          .split("; ")
          .find((x) => x.startsWith("ua_csrf="))
          ?.slice(8) ?? "",
      origin: location.origin,
    }));
  const duplicateResult = await page.request.get(
    `/api/v1/imports/${duplicate}`,
    { headers: await authHeaders(page) },
  );
  expect((await duplicateResult.json()).duplicate_rows).toBe(1);
  await page.goto("/customers");
  await page.getByLabel("Application customer ID").fill("acme");
  await page.getByLabel("Provider customer ID").fill("cus_acme");
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved successfully.");
  await page.goto("/metrics");
  await page.getByLabel("Application metric").fill("requests");
  await page.getByLabel("Provider meter ID").fill("meter_requests");
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved successfully.");
  await page.goto("/pricing");
  await page.getByLabel("Metric key", { exact: true }).fill("requests");
  await page.getByLabel("Provider price ID").fill("price_requests");
  await page.getByLabel("Rate per unit").fill("0.02");
  await page.getByRole("button", { name: "Create pricing version" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved successfully.");
  await upload(
    "BILLING_USAGE",
    "providerCustomerId,providerMeterId,periodStart,periodEnd,quantity\ncus_acme,meter_requests,2026-10-01T00:00:00Z,2026-11-01T00:00:00Z,92000",
  );
  await upload(
    "INVOICE_LINES",
    "id,invoiceId,providerCustomerId,providerPriceId,periodStart,periodEnd,quantity,amountMinorUnits,currency,componentType,invoiceStatus\nil_1,in_1,cus_acme,price_requests,2026-10-01T00:00:00Z,2026-11-01T00:00:00Z,92000,184000,USD,USAGE,paid",
  );
  await page.goto("/imports");
  await page
    .getByRole("button", { name: "Create snapshot", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Saved successfully.");
  await page.goto("/reconciliations");
  await page.getByLabel("Application usage import").selectOption(sourceId);
  await page.getByRole("button", { name: "Check audit readiness" }).click();
  await page.getByRole("button", { name: "Start reconciliation" }).click();
  await expect(
    page.getByRole("cell", { name: "2000.00", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "1840.00", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "160", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Open / }).first().click();
  await expect(page).toHaveURL(/findings\//);
  const findingId = page.url().split("/").pop()!;
  await page.getByLabel("New review status").selectOption("INVESTIGATING");
  await page
    .getByLabel("Investigation note")
    .fill("Checking the provider delivery logs.");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(
    page.getByRole("cell", { name: "Checking the provider delivery logs." }),
  ).toBeVisible();
  const headers = await authHeaders(page);
  const detail = await (
    await page.request.get(`/api/v1/findings/${findingId}`, { headers })
  ).json();
  await page.goto("/reconciliations/" + detail.run_id);
  await page.getByRole("button", { name: "Generate CSV report" }).click();
  await page.goto("/reports");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).first().click();
  expect((await download).suggestedFilename()).toMatch(/usageaudit.*\.csv/);
  const reports = await (
    await page.request.get("/api/v1/reports", { headers })
  ).json();
  const context = await browser.newContext();
  const foreign = await context.newPage();
  await foreign.goto("/register");
  await foreign.getByLabel("Full name").fill("Foreign User");
  await foreign
    .getByLabel("Work email")
    .fill(`foreign-${randomUUID()}@example.test`);
  await foreign.getByLabel("Password").fill("BrowserTestPassword!23");
  await foreign
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await foreign.getByLabel("Organization name").fill("Foreign workspace");
  await foreign.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    foreign.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  for (const path of [
    `imports/${sourceId}`,
    `findings/${findingId}`,
    `reports/${reports[0].id}/download`,
  ]) {
    const r = await foreign.request.get("/api/v1/" + path, {
      headers: await authHeaders(foreign),
    });
    expect(r.status()).toBe(404);
  }
  await context.close();
  await page.goto("/dashboard");
  await expect(page.getByText("USD 1,840.00", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".local/dashboard-desktop.png",
    fullPage: true,
  });
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/dashboard-mobile.png",
    fullPage: true,
  });
});

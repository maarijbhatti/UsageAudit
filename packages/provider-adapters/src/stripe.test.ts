import { afterEach, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import Stripe from "stripe";
import { StripeAdapter } from "./stripe";
import { FixtureAdapter } from "./provider";
let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((e) => (e ? reject(e) : resolve())),
    );
    server = undefined;
  }
});
it("uses only GET requests, follows pagination, normalizes invoice components and preserves raw evidence", async () => {
  const calls: string[] = [];
  server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const url = new URL(req.url!, "http://localhost");
    res.setHeader("Content-Type", "application/json");
    let data: unknown;
    if (url.pathname === "/v1/customers")
      data = {
        object: "list",
        data: [{ id: "cus_1", name: "Acme" }],
        has_more: false,
      };
    else if (url.pathname === "/v1/billing/meters")
      data = { object: "list", data: [], has_more: false };
    else if (url.pathname.endsWith("/event_summaries"))
      data = {
        object: "list",
        data: [
          {
            id: "sum_1",
            aggregated_value: 92000,
            start_time: 1790812800,
            end_time: 1793491200,
          },
        ],
        has_more: false,
      };
    else if (url.pathname === "/v1/prices")
      data = { object: "list", data: [], has_more: false };
    else if (url.pathname === "/v1/prices/price_1")
      data = {
        id: "price_1",
        billing_scheme: "per_unit",
        recurring: { usage_type: "metered" },
        transform_quantity: null,
        custom_unit_amount: null,
        tax_behavior: "exclusive",
      };
    else if (url.pathname === "/v1/invoices")
      data = {
        object: "list",
        data: [
          {
            id: url.searchParams.has("starting_after") ? "in_2" : "in_1",
            status: "paid",
            currency: "usd",
            total: 184000,
          },
        ],
        has_more: !url.searchParams.has("starting_after"),
      };
    else if (url.pathname === "/v1/invoices/in_1/lines")
      data = {
        object: "list",
        data: [
          {
            id: "il_1",
            amount: 184000,
            subtotal: 184000,
            currency: "usd",
            quantity: 92000,
            quantity_decimal: "92000",
            period: { start: 1790812800, end: 1793491199 },
            pricing: { price_details: { price: "price_1" } },
            parent: null,
            discounts: [],
            discount_amounts: [],
            pretax_credit_amounts: [],
            taxes: [],
          },
        ],
        has_more: false,
      };
    else data = { object: "list", data: [], has_more: false };
    res.end(JSON.stringify(data));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server");
  const client = new Stripe("rk_test_fixture", {
    host: "127.0.0.1",
    port: address.port,
    protocol: "http",
    maxNetworkRetries: 0,
  });
  const adapter = new StripeAdapter("rk_test_fixture", client);
  expect((await adapter.testConnection()).environment).toBe("test");
  expect(await adapter.listCustomers()).toEqual([
    { id: "cus_1", name: "Acme" },
  ]);
  const snapshot = await adapter.fetchSnapshot({
    snapshotId: "snapshot",
    observedAt: "2026-11-06T00:00:00Z",
    periodStart: "2026-10-01T00:00:00Z",
    periodEnd: "2026-11-01T00:00:00Z",
    customers: ["cus_1"],
    meters: ["meter_1"],
  });
  expect(snapshot.summaries[0]?.quantity).toBe("92000");
  expect(snapshot.lines[0]).toMatchObject({
    amountMinorUnits: "184000",
    periodEnd: "2026-11-01T00:00:00.000Z",
    componentType: "USAGE",
  });
  expect(calls.every((c) => c.startsWith("GET "))).toBe(true);
  expect(calls.some((c) => c.includes("starting_after=in_1"))).toBe(true);
  expect(snapshot.raw).toBeDefined();
  const fixture = new FixtureAdapter(snapshot);
  expect(
    (
      await fixture.fetchSnapshot({
        snapshotId: "new",
        observedAt: "2026-11-07T00:00:00Z",
        periodStart: "2026-10-01T00:00:00Z",
        periodEnd: "2026-11-01T00:00:00Z",
        customers: [],
        meters: [],
      })
    ).id,
  ).toBe("new");
});
it("rejects unrestricted keys", () => {
  expect(() => new StripeAdapter("sk_test_secret")).toThrow("restricted");
});

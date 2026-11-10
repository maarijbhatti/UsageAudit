import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDataSource } from "../../apps/api/src/database/data-source";
import { createApp } from "../../apps/api/src/main";
import { DB } from "../../apps/api/src/common/database";
import { startWorker } from "../../apps/worker/src/runner";
import { ImportsService } from "../../apps/api/src/modules/imports/imports.service";
import { ReconciliationService } from "../../apps/api/src/modules/reconciliation/reconciliation.service";

test("real PostgreSQL: migrations, authentication, sessions and tenant authorization", async () => {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl || !new URL(testUrl).pathname.endsWith("_test"))
    throw new Error(
      "TEST_DATABASE_URL must identify a dedicated _test database",
    );
  const admin = await createDataSource().initialize();
  const name = new URL(testUrl).pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Unsafe test database name");
  const existing: unknown[] = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname=$1",
    [name],
  );
  if (!existing.length) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.destroy();
  process.env.DATABASE_URL = testUrl;
  const db = await createDataSource().initialize();
  await db.runMigrations();
  await db.destroy();
  const app = await createApp();
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  const worker = await startWorker();
  const call = (
    path: string,
    body?: unknown,
    cookies = "",
    csrf = "",
    org = "",
  ) =>
    fetch(url + "/api/v1/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        connection: "close",
        "content-type": "application/json",
        origin: process.env.WEB_ORIGIN!,
        cookie: cookies,
        "x-csrf-token": csrf,
        "x-organization-id": org,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const cookiesOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");
  const csrfOf = (s: string) => /ua_csrf=([^;]+)/.exec(s)?.[1] ?? "";
  try {
    const email = `owner-${randomUUID()}@example.test`;
    let res = await call("auth/register", {
      email,
      password: "IntegrationPassword!23",
      displayName: "Owner",
    });
    assert.equal(res.status, 201);
    let cookies = cookiesOf(res);
    let csrf = csrfOf(cookies);
    assert.match(res.headers.getSetCookie()[0]!, /HttpOnly/);
    res = await call("auth/me", undefined, cookies);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { email: string }).email, email);
    res = await call(
      "organizations",
      { name: "Isolated organization" },
      cookies,
      csrf,
    );
    assert.equal(res.status, 201);
    const org = ((await res.json()) as { id: string }).id;
    assert.equal(
      (await call(`organizations/${org}`, undefined, cookies, csrf, org))
        .status,
      200,
    );
    assert.equal(
      (await call("organizations", { name: "CSRF attack" }, cookies)).status,
      403,
    );
    const other = await call("auth/register", {
      email: `other-${randomUUID()}@example.test`,
      password: "IntegrationPassword!23",
      displayName: "Other",
    });
    const foreignCookies = cookiesOf(other);
    assert.equal(
      (
        await call(
          `organizations/${org}`,
          undefined,
          foreignCookies,
          csrfOf(foreignCookies),
          org,
        )
      ).status,
      403,
    );
    const foreignOrgResponse = await call(
      "organizations",
      { name: "Foreign organization" },
      foreignCookies,
      csrfOf(foreignCookies),
    );
    const foreignOrg = ((await foreignOrgResponse.json()) as { id: string }).id;
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await call(path, body, cookies, csrf, org);
      const data: unknown = await response.json();
      assert.ok(
        response.ok,
        `${path}: ${response.status} ${JSON.stringify(data)}`,
      );
      return data as T;
    };
    const wait = async <T extends { status: string }>(
      path: string,
    ): Promise<T> => {
      for (let i = 0; i < 300; i++) {
        const data = await api<T>(path);
        if (data.status === "FAILED") assert.fail(JSON.stringify(data));
        if (data.status === "COMPLETED") return data;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(`Timed out: ${path}`);
    };
    const upload = async (type: string, text: string) => {
      const form = new FormData();
      form.set("importType", type);
      form.set("file", new Blob([text], { type: "text/csv" }), "fixture.csv");
      const response = await fetch(url + "/api/v1/imports", {
        method: "POST",
        headers: {
          connection: "close",
          origin: process.env.WEB_ORIGIN!,
          cookie: cookies,
          "x-csrf-token": csrf,
          "x-organization-id": org,
        },
        body: form,
      });
      const data = (await response.json()) as { id: string };
      assert.equal(response.status, 202, JSON.stringify(data));
      await api(`imports/${data.id}/confirm`, { columnMapping: {} });
      await worker.dispatch();
      return wait<{
        id: string;
        status: string;
        accepted_rows: number;
        duplicate_rows: number;
      }>(`imports/${data.id}`);
    };
    const usage =
      "eventId,sourceCustomerId,metricKey,quantity,unit,occurredAt,billable\n" +
      Array.from(
        { length: 100000 },
        (_, i) => `evt_${i},acme,requests,1,request,2026-10-15T00:00:00Z,true`,
      ).join("\n");
    const source = await upload("APPLICATION_USAGE", usage);
    assert.equal(source.accepted_rows, 100000);
    const repeated = await upload("APPLICATION_USAGE", usage);
    assert.equal(repeated.accepted_rows, 0);
    assert.equal(repeated.duplicate_rows, 100000);
    await app.get(ImportsService).process(org, repeated.id);
    const total = (await worker.db.query(
      "SELECT sum(quantity)::text AS total FROM usage_events WHERE organization_id=$1",
      [org],
    )) as { total: string }[];
    assert.equal(total[0]!.total, "100000");
    const start = "2026-10-01T00:00:00Z",
      end = "2026-11-01T00:00:00Z";
    await api("customer-mappings", {
      sourceCustomerId: "acme",
      providerCustomerId: "cus_acme",
      effectiveFrom: start,
    });
    await api("metric-mappings", {
      sourceMetricKey: "requests",
      providerMeterId: "meter_requests",
      aggregationMethod: "SUM",
      effectiveFrom: start,
    });
    const price = {
      metricKey: "requests",
      providerPriceId: "price_requests",
      pricingModel: "FLAT_PER_UNIT",
      currency: "USD",
      unitPrice: "0.02",
      effectiveFrom: start,
      effectiveTo: end,
    };
    await api("pricing-rules", price);
    assert.equal(
      (await call("pricing-rules", price, cookies, csrf, org)).status,
      409,
    );
    const provider = await upload(
      "BILLING_USAGE",
      `providerCustomerId,providerMeterId,periodStart,periodEnd,quantity\ncus_acme,meter_requests,${start},${end},92000`,
    );
    const invoice = await upload(
      "INVOICE_LINES",
      `id,invoiceId,providerCustomerId,providerPriceId,periodStart,periodEnd,quantity,amountMinorUnits,currency,componentType,invoiceStatus\nil_1,in_1,cus_acme,price_requests,${start},${end},92000,184000,USD,USAGE,paid`,
    );
    const snapshot = await api<{ id: string }>("provider-snapshots", {
      usageImportId: provider.id,
      invoiceImportId: invoice.id,
    });
    const request = {
      periodStart: start,
      periodEnd: end,
      sourceImportBatchId: source.id,
      providerSnapshotId: snapshot.id,
      requestKey: randomUUID(),
    };
    const run = await api<{ id: string }>("reconciliation-runs", request);
    const same = await api<{ id: string }>("reconciliation-runs", request);
    assert.equal(run.id, same.id);
    await worker.dispatch();
    const completed = await wait<{
      status: string;
      result_summary: {
        expectedAmount: string;
        actualAmount: string;
        varianceAmount: string;
      }[];
    }>(`reconciliation-runs/${run.id}`);
    assert.deepEqual(
      completed.result_summary.map((r) => [
        r.expectedAmount,
        r.actualAmount,
        r.varianceAmount,
      ]),
      [["2000.00", "1840.00", "160"]],
    );
    await app.get(ReconciliationService).process(org, run.id);
    const findings = await api<{ items: { id: string }[] }>(
      `reconciliation-runs/${run.id}/findings`,
    );
    assert.equal(findings.items.length, 1);
    const findingId = findings.items[0]!.id;
    await api(`findings/${findingId}/reviews`, {
      newStatus: "INVESTIGATING",
      comment: "Checking delivery records.",
    });
    const detail = await api<{ review_status: string; reviews: unknown[] }>(
      `findings/${findingId}`,
    );
    assert.equal(detail.review_status, "INVESTIGATING");
    assert.equal(detail.reviews.length, 1);
    await api("pricing-rules", {
      ...price,
      effectiveFrom: end,
      effectiveTo: "2026-12-01T00:00:00Z",
      unitPrice: "0.03",
    });
    const unchanged = await api<typeof completed>(
      `reconciliation-runs/${run.id}`,
    );
    assert.deepEqual(unchanged.result_summary, completed.result_summary);
    const report = await api<{ id: string }>("reports", {
      reconciliationRunId: run.id,
    });
    await worker.dispatch();
    await wait(`reports/${report.id}`);
    const csv = await call(
      `reports/${report.id}/download`,
      undefined,
      cookies,
      csrf,
      org,
    );
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), /160\.000000/);
    for (const path of [
      `imports/${source.id}`,
      `findings/${findingId}`,
      `reports/${report.id}`,
      `reports/${report.id}/download`,
      `reconciliation-runs/${run.id}`,
    ])
      assert.equal(
        (
          await call(
            path,
            undefined,
            foreignCookies,
            csrfOf(foreignCookies),
            foreignOrg,
          )
        ).status,
        404,
        path,
      );
    const audit = await api<{ action: string }[]>("audit-logs");
    assert.ok(audit.some((a) => a.action === "FINDING_REVIEWED"));
    await api(`organizations/${org}/invitations`, {
      email: (
        (await (await call("auth/me", undefined, foreignCookies)).json()) as {
          email: string;
        }
      ).email,
      role: "VIEWER",
    });
    assert.equal(
      (
        await call(
          "dashboard/overview",
          undefined,
          foreignCookies,
          csrfOf(foreignCookies),
          org,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "pricing-rules",
          price,
          foreignCookies,
          csrfOf(foreignCookies),
          org,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "reconciliation-runs",
          { ...request, requestKey: randomUUID() },
          foreignCookies,
          csrfOf(foreignCookies),
          org,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          `findings/${findingId}/reviews`,
          { newStatus: "CONFIRMED", comment: "Not allowed" },
          foreignCookies,
          csrfOf(foreignCookies),
          org,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "reconciliation-runs",
          request,
          foreignCookies,
          csrfOf(foreignCookies),
          foreignOrg,
        )
      ).status,
      404,
    );
    const raw = new FormData();
    raw.set("importType", "APPLICATION_USAGE");
    raw.set(
      "file",
      new Blob(['eventId,quantity\n"unterminated']),
      "malformed.csv",
    );
    const badResponse = await fetch(url + "/api/v1/imports", {
      method: "POST",
      headers: {
        origin: process.env.WEB_ORIGIN!,
        cookie: cookies,
        "x-csrf-token": csrf,
        "x-organization-id": org,
      },
      body: raw,
    });
    assert.equal(badResponse.status, 202);
    const badId = ((await badResponse.json()) as { id: string }).id;
    await api(`imports/${badId}/confirm`, { columnMapping: {} });
    await worker.dispatch();
    let failed = false;
    for (let i = 0; i < 100; i++) {
      const b = await api<{ status: string }>(`imports/${badId}`);
      if (b.status === "FAILED") {
        failed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(failed, "failed jobs become visible after bounded retries");
    const jobs =
      await api<
        { id: string; resource_id: string; attempts: number; status: string }[]
      >("jobs");
    const badJob = jobs.find((j) => j.resource_id === badId)!;
    assert.equal(badJob.attempts, 3);
    assert.equal(badJob.status, "FAILED");
    await api("jobs/retry", { jobId: badJob.id });
    await assert.rejects(
      worker.db.query(
        "UPDATE usage_events SET quantity=2 WHERE organization_id=$1",
        [org],
      ),
      /Immutable/,
    );
    res = await call("auth/login", { email, password: "incorrectPassword!23" });
    assert.equal(res.status, 401);
    const oldCookies = cookies,
      oldCsrf = csrf;
    res = await call("auth/refresh", {}, cookies, csrf);
    assert.equal(res.status, 201);
    cookies = cookiesOf(res);
    csrf = csrfOf(cookies);
    assert.equal((await call("auth/me", undefined, oldCookies)).status, 401);
    assert.equal((await call("auth/me", undefined, cookies)).status, 200);
    assert.equal(
      (await call("auth/refresh", {}, oldCookies, oldCsrf)).status,
      401,
    );
    assert.equal(
      (await call("auth/me", undefined, cookies)).status,
      401,
      "refresh replay revokes family",
    );
    res = await call("auth/login", {
      email,
      password: "IntegrationPassword!23",
    });
    cookies = cookiesOf(res);
    csrf = csrfOf(cookies);
    assert.equal((await call("auth/logout", {}, cookies, csrf)).status, 201);
    assert.equal((await call("auth/me", undefined, cookies)).status, 401);
  } finally {
    await worker.close();
    await app.get<ReturnType<typeof createDataSource>>(DB).destroy();
    await app.close();
  }
});

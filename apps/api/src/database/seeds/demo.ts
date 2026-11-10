import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as argon2 from "argon2";
import { createDataSource } from "../data-source";
import { one } from "../../common/database";
import { Storage } from "../../common/storage";
import { ImportsService } from "../../modules/imports/imports.service";
import { ConfigurationService } from "../../modules/pricing/configuration";
import { SnapshotsService } from "../../modules/connections/snapshots.service";
import { ReconciliationService } from "../../modules/reconciliation/reconciliation.service";
import { ReportsService } from "../../modules/reports/reports";
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeding is disabled in production");
  const db = await createDataSource().initialize();
  try {
    if (
      await one(db, "SELECT id FROM organizations WHERE slug='demo-orbit-ai'")
    ) {
      console.log("Demo already seeded; preserved existing records.");
      return;
    }
    const hash = await argon2.hash("DemoUsageAudit!2026", {
      type: argon2.argon2id,
    });
    const ids = await db.transaction(async (manager) => {
      const users: string[] = [];
      for (const [email, name] of [
        ["owner@usageaudit.local", "Alex Morgan"],
        ["analyst@usageaudit.local", "Sam Chen"],
        ["viewer@usageaudit.local", "Jordan Lee"],
      ]) {
        const user = await one<{ id: string }>(
          manager,
          "INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id",
          [email, hash, name],
        );
        users.push(user!.id);
      }
      const org = await one<{ id: string }>(
        manager,
        "INSERT INTO organizations(name,slug) VALUES('Orbit AI','demo-orbit-ai') RETURNING id",
      );
      const other = await one<{ id: string }>(
        manager,
        "INSERT INTO organizations(name,slug) VALUES('Northstar Labs','demo-northstar') RETURNING id",
      );
      for (let i = 0; i < users.length; i++)
        await manager.query(
          "INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,$3)",
          [org!.id, users[i], ["OWNER", "ANALYST", "VIEWER"][i]],
        );
      await manager.query(
        "INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'OWNER')",
        [other!.id, users[2]],
      );
      return { org: org!.id, owner: users[0]! };
    });
    const storage = new Storage();
    await storage.initialize();
    const imports = new ImportsService(db, storage),
      config = new ConfigurationService(db),
      snapshots = new SnapshotsService(db),
      runs = new ReconciliationService(db, config, snapshots, imports),
      reports = new ReportsService(db, storage);
    await mkdir(".local/uploads", { recursive: true });
    const ingest = async (file: string, type: string) => {
      const path = ".local/uploads/" + randomUUID() + ".csv";
      await copyFile("fixtures/" + file, path);
      const size = (await stat(path)).size;
      const batch = await imports.upload(ids.org, ids.owner, type, {
        fieldname: "file",
        originalname: file,
        encoding: "7bit",
        mimetype: "text/csv",
        size,
        destination: ".local/uploads",
        filename: file,
        path,
        buffer: Buffer.alloc(0),
        stream: createReadStream(path),
      });
      await imports.confirm(ids.org, ids.owner, batch!.id, {});
      await imports.process(ids.org, batch!.id);
      await db.query(
        "UPDATE job_outbox SET status='COMPLETED' WHERE resource_id=$1",
        [batch!.id],
      );
      return batch!.id;
    };
    const usage = await ingest("valid-usage.csv", "APPLICATION_USAGE"),
      billing = await ingest("billing-usage.csv", "BILLING_USAGE"),
      invoice = await ingest("invoice-lines.csv", "INVOICE_LINES");
    const start = "2026-10-01T00:00:00Z",
      end = "2026-11-01T00:00:00Z";
    for (const name of ["acme", "atlas", "beacon", "cedar", "delta"])
      await config.customer(ids.org, ids.owner, {
        sourceCustomerId: name,
        providerCustomerId: "cus_" + name,
        effectiveFrom: start,
      });
    for (const metric of ["requests", "tokens"])
      await config.metric(ids.org, ids.owner, {
        sourceMetricKey: metric,
        providerMeterId: "meter_" + metric,
        aggregationMethod: "SUM",
        effectiveFrom: start,
      });
    await config.price(ids.org, ids.owner, {
      metricKey: "requests",
      providerPriceId: "price_requests",
      pricingModel: "FLAT_PER_UNIT",
      currency: "USD",
      unitPrice: "0.02",
      effectiveFrom: start,
      effectiveTo: end,
    });
    await config.price(ids.org, ids.owner, {
      metricKey: "requests",
      providerPriceId: "price_requests_v2",
      pricingModel: "FLAT_PER_UNIT",
      currency: "USD",
      unitPrice: "0.025",
      effectiveFrom: end,
    });
    const provider = await snapshots.fromImports(ids.org, billing, invoice);
    const run = await runs.create(ids.org, ids.owner, {
      periodStart: start,
      periodEnd: end,
      sourceImportBatchId: usage,
      providerSnapshotId: provider.id,
      requestKey: "demo-october",
    });
    await runs.process(ids.org, run.id);
    const report = await reports.create(ids.org, ids.owner, run.id);
    await reports.process(ids.org, report.id);
    await db.query(
      "UPDATE job_outbox SET status='COMPLETED' WHERE organization_id=$1",
      [ids.org],
    );
    console.log(
      "Demo ready: Orbit AI and Northstar Labs; October audit and report completed. Local accounts are documented in README.md.",
    );
  } finally {
    await db.destroy();
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Seed failed");
  process.exitCode = 1;
});

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { randomUUID } from "node:crypto";
import type {
  ProviderSnapshot,
  ProviderUsageSummary,
  ProviderInvoiceLine,
} from "@usageaudit/shared-types";
import { DB, one, rows } from "../../common/database";
import { hash } from "../../common/security";
import type { Batch } from "../imports/imports.service";
@Injectable()
export class SnapshotsService {
  constructor(@Inject(DB) private db: DataSource) {}
  async get(org: string, id: string) {
    const snapshot = await one<{ payload: ProviderSnapshot }>(
      this.db,
      "SELECT payload FROM provider_snapshots WHERE organization_id=$1 AND id=$2",
      [org, id],
    );
    if (!snapshot) throw new NotFoundException("Provider snapshot not found");
    return snapshot.payload;
  }
  async fromImports(org: string, usageId: string, invoiceId: string) {
    const batches = await rows<Batch>(
      this.db,
      "SELECT * FROM import_batches WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      [org, [usageId, invoiceId]],
    );
    const usage = batches.find(
      (b) => b.id === usageId && b.import_type === "BILLING_USAGE",
    );
    const invoices = batches.find(
      (b) => b.id === invoiceId && b.import_type === "INVOICE_LINES",
    );
    if (!usage || !invoices)
      throw new NotFoundException("Billing imports not found");
    if (batches.some((b) => b.status !== "COMPLETED"))
      throw new BadRequestException("Billing imports must be completed");
    const records = await rows<{
      batch_id: string;
      normalized_payload: unknown;
    }>(
      this.db,
      "SELECT batch_id,normalized_payload FROM raw_import_records WHERE organization_id=$1 AND batch_id=ANY($2::uuid[]) AND validation_status='ACCEPTED' ORDER BY row_number",
      [org, [usageId, invoiceId]],
    );
    const id = randomUUID(),
      observedAt = new Date().toISOString();
    const summaries = records
      .filter((r) => r.batch_id === usageId)
      .map((r) => ({
        ...(r.normalized_payload as Omit<
          ProviderUsageSummary,
          "snapshotId" | "observedAt"
        >),
        snapshotId: id,
        observedAt,
      }));
    const lines = records
      .filter((r) => r.batch_id === invoiceId)
      .map((r) => r.normalized_payload as ProviderInvoiceLine);
    const identities = summaries.map((s) =>
      JSON.stringify([
        s.providerCustomerId,
        s.providerMeterId,
        s.periodStart,
        s.periodEnd,
      ]),
    );
    if (
      new Set(identities).size !== identities.length ||
      new Set(lines.map((l) => l.id)).size !== lines.length
    )
      throw new BadRequestException(
        "Duplicate provider identities; export one row per summary and line",
      );
    const snapshot: ProviderSnapshot = {
      id,
      observedAt,
      complete: batches.every((b) => b.rejected_rows === 0),
      summaries,
      lines,
      limitations: [
        "Imported provider exports are supplied by the user; event-level delivery is not independently verified.",
      ],
    };
    await this.persist(org, snapshot, null, {
      usageImportId: usageId,
      invoiceImportId: invoiceId,
    });
    return snapshot;
  }
  async persist(
    org: string,
    snapshot: ProviderSnapshot,
    connectionId: string | null,
    source: Record<string, unknown>,
  ) {
    await this.db.transaction(async (db) => {
      await db.query(
        "INSERT INTO provider_snapshots(id,organization_id,connection_id,snapshot_type,source_reference,fetched_at,content_hash,status,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          snapshot.id,
          org,
          connectionId,
          connectionId ? "STRIPE" : "CSV",
          JSON.stringify(source),
          snapshot.observedAt,
          hash(JSON.stringify(snapshot)),
          snapshot.complete ? "COMPLETE" : "INCOMPLETE",
          JSON.stringify(snapshot),
        ],
      );
      await this.persistNormalized(db, org, snapshot);
    });
  }
  private async persistNormalized(
    db: EntityManager,
    org: string,
    s: ProviderSnapshot,
  ) {
    for (const u of s.summaries)
      await db.query(
        "INSERT INTO provider_meter_summaries(organization_id,snapshot_id,provider_customer_id,provider_meter_id,period_start,period_end,aggregated_quantity) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          org,
          s.id,
          u.providerCustomerId,
          u.providerMeterId,
          u.periodStart,
          u.periodEnd,
          u.quantity,
        ],
      );
    const invoices = new Map<string, string>();
    for (const l of s.lines) {
      let id = invoices.get(l.invoiceId);
      if (!id) {
        id = randomUUID();
        invoices.set(l.invoiceId, id);
        await db.query(
          "INSERT INTO provider_invoices(id,organization_id,snapshot_id,provider_invoice_id,provider_customer_id,invoice_status,currency) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id,
            org,
            s.id,
            l.invoiceId,
            l.providerCustomerId,
            l.invoiceStatus,
            l.currency,
          ],
        );
      }
      await db.query(
        "INSERT INTO provider_invoice_lines(organization_id,provider_invoice_record_id,provider_line_id,provider_price_id,period_start,period_end,quantity,amount_minor_units,currency,component_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          org,
          id,
          l.id,
          l.providerPriceId,
          l.periodStart,
          l.periodEnd,
          l.quantity,
          l.amountMinorUnits,
          l.currency,
          l.componentType,
          JSON.stringify(l),
        ],
      );
    }
  }
}

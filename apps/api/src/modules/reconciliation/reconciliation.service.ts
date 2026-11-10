import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import {
  ALGORITHM_VERSION,
  generateReconciliationResult,
  resolveCustomerMapping,
  resolveMetricMapping,
  resolvePricingRule,
} from "@usageaudit/billing-core";
import type {
  NormalizedUsageEvent,
  ReconciliationInput,
  ReconciliationResult,
} from "@usageaudit/shared-types";
import { getConfig } from "@usageaudit/config";
import { DB, audit, enqueue, one, rows } from "../../common/database";
import { hash } from "../../common/security";
import { ConfigurationService, validatePeriod } from "../pricing/configuration";
import { SnapshotsService } from "../connections/snapshots.service";
import { ImportsService } from "../imports/imports.service";
export interface RunRequest {
  periodStart: string;
  periodEnd: string;
  sourceImportBatchId: string;
  providerSnapshotId: string;
  requestKey: string;
}
export interface Run {
  id: string;
  status: string;
  input_snapshot: ReconciliationInput;
  result_summary: ReconciliationResult[] | null;
}
@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(DB) private db: DataSource,
    @Inject(ConfigurationService) private configuration: ConfigurationService,
    @Inject(SnapshotsService) private snapshots: SnapshotsService,
    @Inject(ImportsService) private imports: ImportsService,
  ) {}
  async readiness(org: string, d: RunRequest) {
    validatePeriod(d.periodStart, d.periodEnd);
    const batch = await this.imports.get(org, d.sourceImportBatchId);
    await this.snapshots.get(org, d.providerSnapshotId);
    const cfg = await this.configuration.snapshot(org);
    const groups = await rows<{ customer: string; metric: string; time: Date }>(
      this.db,
      "SELECT e.source_customer_id AS customer,e.metric_key AS metric,min(e.occurred_at) AS time FROM usage_events e JOIN import_event_refs r ON r.organization_id=e.organization_id AND r.event_id=e.id WHERE r.organization_id=$1 AND r.batch_id=$2 AND e.occurred_at >= $3 AND e.occurred_at < $4 GROUP BY e.source_customer_id,e.metric_key",
      [org, batch.id, d.periodStart, d.periodEnd],
    );
    const warnings: string[] = [];
    if (batch.rejected_rows)
      warnings.push(
        `${batch.rejected_rows} rejected source rows; financial evidence is incomplete.`,
      );
    if (!groups.length) warnings.push("No source usage in this period.");
    for (const g of groups) {
      const t = g.time.toISOString(),
        cm = resolveCustomerMapping(cfg.customerMappings, g.customer, t);
      if (!cm) warnings.push("Unmapped customer: " + g.customer);
      if (!resolveMetricMapping(cfg.metricMappings, g.metric, t))
        warnings.push("Unmapped metric: " + g.metric);
      if (!resolvePricingRule(cfg.pricing, g.metric, cm?.id, t))
        warnings.push("Missing price: " + g.metric);
    }
    return {
      ready: batch.status === "COMPLETED",
      warnings: [...new Set(warnings)],
      componentCount: groups.length,
    };
  }
  async create(org: string, user: string, d: RunRequest) {
    validatePeriod(d.periodStart, d.periodEnd);
    const batch = await this.imports.get(org, d.sourceImportBatchId);
    if (
      batch.status !== "COMPLETED" ||
      batch.import_type !== "APPLICATION_USAGE"
    )
      throw new BadRequestException(
        "Select a completed application usage import",
      );
    const provider = await this.snapshots.get(org, d.providerSnapshotId);
    return this.db.transaction("REPEATABLE READ", async (db) => {
      const prior = await one<Run>(
        db,
        "SELECT id,status FROM reconciliation_runs WHERE organization_id=$1 AND request_key=$2",
        [org, d.requestKey],
      );
      if (prior) return prior;
      const cfg = await this.configuration.snapshot(org, db);
      const events = (
        await rows<{ payload: NormalizedUsageEvent }>(
          db,
          // Newly imported tenants may not be in PostgreSQL's statistics yet.
          // Keep each reference lookup bounded by the unique (organization_id,id)
          // key instead of allowing two underestimated scans to form a cross product.
          `SELECT e.payload FROM import_event_refs r
           JOIN LATERAL (
             SELECT payload,source_event_id FROM usage_events
             WHERE organization_id=r.organization_id AND id=r.event_id LIMIT 1
           ) e ON true
           WHERE r.organization_id=$1 AND r.batch_id=$2 ORDER BY e.source_event_id`,
          [org, batch.id],
        )
      ).map((r) => r.payload);
      const duplicates = await rows<{ eventId: string }>(
        db,
        `SELECT normalized_payload->>'eventId' AS "eventId" FROM raw_import_records WHERE organization_id=$1 AND batch_id=$2 AND validation_status='DUPLICATE'`,
        [org, batch.id],
      );
      const input: ReconciliationInput = {
        ...cfg,
        events,
        provider,
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        sourceComplete: batch.rejected_rows === 0,
        asOf: new Date().toISOString(),
        processingDelaySeconds: getConfig().PROCESSING_DELAY_SECONDS,
        duplicateEventIds: duplicates.map((x) => x.eventId),
      };
      const id = randomUUID();
      await db.query(
        "INSERT INTO reconciliation_runs(id,organization_id,period_start,period_end,source_import_batch_id,provider_snapshot_id,input_snapshot,algorithm_version,request_key,initiated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          id,
          org,
          d.periodStart,
          d.periodEnd,
          batch.id,
          provider.id,
          JSON.stringify(input),
          ALGORITHM_VERSION,
          d.requestKey,
          user,
        ],
      );
      await enqueue(db, org, "RECONCILE", id);
      await audit(db, org, user, "RECONCILIATION_REQUESTED", "run", id);
      return { id, status: "QUEUED" };
    });
  }
  async get(org: string, id: string) {
    const run = await one<Run>(
      this.db,
      "SELECT id,status,period_start,period_end,source_import_batch_id,provider_snapshot_id,result_summary,algorithm_version,started_at,completed_at,failure_reason,created_at FROM reconciliation_runs WHERE organization_id=$1 AND id=$2",
      [org, id],
    );
    if (!run) throw new NotFoundException("Run not found");
    return run;
  }
  async process(org: string, id: string) {
    await this.db.transaction(async (db) => {
      const run = await one<Run>(
        db,
        "SELECT * FROM reconciliation_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [org, id],
      );
      if (!run) throw new Error("Run not found");
      if (run.status === "COMPLETED") return;
      await db.query(
        "UPDATE reconciliation_runs SET status='PROCESSING',started_at=now() WHERE organization_id=$1 AND id=$2",
        [org, id],
      );
      const results = generateReconciliationResult(run.input_snapshot);
      for (const result of results) {
        for (const f of result.findings) {
          const fingerprint = hash(
            JSON.stringify([result.customerId, result.metricKey, f.type]),
          );
          await db.query(
            `INSERT INTO reconciliation_findings(organization_id,run_id,customer_identifier,metric_key,finding_type,severity,evidence_status,expected_quantity,actual_quantity,expected_amount,actual_amount,variance_amount,currency,evidence_payload,finding_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(run_id,finding_fingerprint) DO NOTHING`,
            [
              org,
              id,
              result.customerId,
              result.metricKey,
              f.type,
              result.varianceAmount && result.varianceAmount !== "0"
                ? "HIGH"
                : "MEDIUM",
              result.evidenceStatus,
              result.expectedQuantity,
              result.providerQuantity,
              result.expectedAmount,
              result.actualAmount,
              result.varianceAmount,
              result.currency,
              JSON.stringify({ ...result, message: f.message }),
              fingerprint,
            ],
          );
        }
      }
      await db.query(
        "UPDATE reconciliation_runs SET status='COMPLETED',completed_at=now(),failure_reason=NULL,result_summary=$3 WHERE organization_id=$1 AND id=$2",
        [org, id, JSON.stringify(results)],
      );
    });
  }
  async evidence(org: string, id: string, customer: string, metric: string) {
    const row = await one<{ input_snapshot: ReconciliationInput }>(
      this.db,
      "SELECT input_snapshot FROM reconciliation_runs WHERE organization_id=$1 AND id=$2",
      [org, id],
    );
    if (!row) throw new NotFoundException();
    const input = row.input_snapshot;
    return {
      ...input,
      events: input.events
        .filter(
          (e) => e.sourceCustomerId === customer && e.metricKey === metric,
        )
        .slice(0, 100),
      sourceRecordLimit: 100,
    };
  }
}

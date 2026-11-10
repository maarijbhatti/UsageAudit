import { Queue, Worker, Job } from "bullmq";
import { createDataSource } from "../../api/src/database/data-source";
import { Storage } from "../../api/src/common/storage";
import { rows, one } from "../../api/src/common/database";
import { logger } from "../../api/src/common/errors";
import { ImportsService } from "../../api/src/modules/imports/imports.service";
import { ConfigurationService } from "../../api/src/modules/pricing/configuration";
import { SnapshotsService } from "../../api/src/modules/connections/snapshots.service";
import { ReconciliationService } from "../../api/src/modules/reconciliation/reconciliation.service";
import { ReportsService } from "../../api/src/modules/reports/reports";
import { ConnectionsService } from "../../api/src/modules/connections/connections";
import type { RunRequest } from "../../api/src/modules/reconciliation/reconciliation.service";
interface Work {
  id: string;
  organization_id: string;
  kind: string;
  resource_id: string;
  payload: Record<string, unknown>;
  status: string;
}
export async function startWorker() {
  const db = await createDataSource().initialize();
  const storage = new Storage();
  await storage.initialize();
  const imports = new ImportsService(db, storage),
    config = new ConfigurationService(db),
    snapshots = new SnapshotsService(db),
    runs = new ReconciliationService(db, config, snapshots, imports),
    reports = new ReportsService(db, storage),
    connections = new ConnectionsService(db, config, snapshots);
  const url = new URL(process.env.REDIS_URL!);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
  const queueName =
    "usageaudit-" + new URL(process.env.DATABASE_URL!).pathname.slice(1);
  const queue = new Queue(queueName, { connection });
  const processJob = async (job: Job<{ outboxId: string }>) => {
    const work = await one<Work>(db, "SELECT * FROM job_outbox WHERE id=$1", [
      job.data.outboxId,
    ]);
    if (!work) throw new Error("Outbox record missing");
    if (work.status === "COMPLETED") return;
    await db.query(
      "UPDATE job_outbox SET attempts=attempts+1,updated_at=now() WHERE id=$1",
      [work.id],
    );
    try {
      if (work.kind === "IMPORT")
        await imports.process(work.organization_id, work.resource_id, (n) =>
          job.updateProgress(n),
        );
      else if (work.kind === "RECONCILE")
        await runs.process(work.organization_id, work.resource_id);
      else if (work.kind === "REPORT")
        await reports.process(work.organization_id, work.resource_id);
      else if (work.kind === "STRIPE_SYNC")
        await connections.process(
          work.organization_id,
          work.resource_id,
          work.payload,
        );
      else throw new Error("Unsupported job type");
      await db.query(
        "UPDATE job_outbox SET status='COMPLETED',error=NULL,updated_at=now() WHERE id=$1",
        [work.id],
      );
    } catch (e) {
      const exhausted = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
      const reason =
        e instanceof Error ? e.message.slice(0, 300) : "Processing failed";
      await db.query(
        "UPDATE job_outbox SET status=$2,error=$3,updated_at=now() WHERE id=$1",
        [work.id, exhausted ? "FAILED" : "ENQUEUED", reason],
      );
      if (exhausted) {
        const table = {
          IMPORT: "import_batches",
          RECONCILE: "reconciliation_runs",
          REPORT: "reports",
        }[work.kind];
        if (table)
          await db.query(
            `UPDATE ${table} SET status='FAILED',failure_reason=$3 WHERE organization_id=$1 AND id=$2`,
            [work.organization_id, work.resource_id, reason],
          );
      }
      throw e;
    }
  };
  const worker = new Worker(queueName, processJob, {
    connection,
    concurrency: 2,
  });
  worker.on("error", (e) =>
    logger.error({ errorType: e.name }, "Worker error"),
  );
  worker.on("failed", (j) =>
    logger.warn({ jobId: j?.id }, "Job attempt failed"),
  );
  let dispatching = false;
  const dispatch = async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      const pending = await rows<Work>(
        db,
        "SELECT * FROM job_outbox WHERE status='PENDING' ORDER BY created_at LIMIT 50",
      );
      for (const w of pending) {
        const old = await queue.getJob(w.id);
        if (old && (await old.getState()) === "failed") await old.remove();
        await queue.add(
          w.kind,
          { outboxId: w.id },
          {
            jobId: w.id,
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: { age: 86400, count: 1000 },
            removeOnFail: false,
          },
        );
        await db.query(
          "UPDATE job_outbox SET status='ENQUEUED',updated_at=now() WHERE id=$1 AND status='PENDING'",
          [w.id],
        );
      }
    } catch (e) {
      logger.error(
        { errorType: e instanceof Error ? e.name : "Unknown" },
        "Outbox dispatch failed",
      );
    } finally {
      dispatching = false;
    }
  };
  let scheduling = false;
  const schedule = async () => {
    if (scheduling) return;
    scheduling = true;
    try {
      const due = await rows<{
        id: string;
        organization_id: string;
        created_by: string;
        next_run_at: Date;
        source_import_batch_id: string;
        provider_snapshot_id: string;
        period_start: Date;
        period_end: Date;
      }>(
        db,
        "SELECT * FROM reconciliation_schedules WHERE enabled AND next_run_at<=now() LIMIT 20",
      );
      for (const s of due) {
        const allowed = await one(
          db,
          "SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND role IN ('OWNER','ADMIN')",
          [s.organization_id, s.created_by],
        );
        if (!allowed) continue;
        const d: RunRequest = {
          periodStart: s.period_start.toISOString(),
          periodEnd: s.period_end.toISOString(),
          sourceImportBatchId: s.source_import_batch_id,
          providerSnapshotId: s.provider_snapshot_id,
          requestKey: `schedule-${s.id}-${s.next_run_at.toISOString()}`,
        };
        await runs.create(s.organization_id, s.created_by, d);
        await db.query(
          "UPDATE reconciliation_schedules SET next_run_at=now()+interval '1 day',updated_at=now() WHERE id=$1 AND next_run_at=$2",
          [s.id, s.next_run_at],
        );
      }
    } catch (e) {
      logger.error(
        { errorType: e instanceof Error ? e.name : "Unknown" },
        "Schedule failed",
      );
    } finally {
      scheduling = false;
    }
  };
  const timer = setInterval(() => void dispatch(), 1500),
    scheduler = setInterval(() => void schedule(), 30000);
  await dispatch();
  logger.info("Worker ready");
  return {
    db,
    queue,
    worker,
    dispatch,
    close: async () => {
      clearInterval(timer);
      clearInterval(scheduler);
      await worker.close();
      await queue.close();
      await db.destroy();
    },
  };
}

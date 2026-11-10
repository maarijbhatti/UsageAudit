import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parse } from "csv-parse";
import { getConfig } from "@usageaudit/config";
import { normalizeUsageEvent } from "@usageaudit/billing-core";
import {
  lineSchema,
  summarySchema,
  validateCsvHeaders,
} from "@usageaudit/provider-adapters";
import type { NormalizedUsageEvent } from "@usageaudit/shared-types";
import { DB, audit, enqueue, one, rows } from "../../common/database";
import { Storage } from "../../common/storage";
export interface Batch {
  id: string;
  organization_id: string;
  import_type: string;
  object_storage_key: string;
  status: string;
  column_mapping: Record<string, string>;
  rejected_rows: number;
  duplicate_rows: number;
  created_at: Date;
  completed_at: Date;
}
interface ParsedRow {
  id: string;
  row: number;
  raw: Record<string, string>;
  normalized: unknown;
  status: "ACCEPTED" | "DUPLICATE" | "REJECTED";
  errors: string[];
}
@Injectable()
export class ImportsService {
  constructor(
    @Inject(DB) private db: DataSource,
    @Inject(Storage) private storage: Storage,
  ) {}
  async upload(
    org: string,
    user: string,
    type: string,
    file: Express.Multer.File,
  ) {
    try {
      if (!file.originalname.toLowerCase().endsWith(".csv") || file.size === 0)
        throw new BadRequestException("Upload a nonempty CSV file");
      const checksum = createHash("sha256");
      for await (const chunk of createReadStream(file.path))
        checksum.update(chunk);
      const id = randomUUID(),
        key = `${org}/imports/${id}.csv`;
      await this.storage.initialize();
      await this.storage.put(key, createReadStream(file.path), file.size);
      return await this.db.transaction(async (db) => {
        const batch = await one<Batch>(
          db,
          "INSERT INTO import_batches(id,organization_id,import_type,original_filename,object_storage_key,checksum,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            id,
            org,
            type,
            file.originalname.slice(0, 200),
            key,
            checksum.digest("hex"),
            user,
          ],
        );
        await audit(db, org, user, "IMPORT_UPLOADED", "import", id);
        return batch;
      });
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }
  async get(org: string, id: string) {
    const b = await one<Batch>(
      this.db,
      "SELECT * FROM import_batches WHERE organization_id=$1 AND id=$2",
      [org, id],
    );
    if (!b) throw new NotFoundException("Import not found");
    return b;
  }
  async preview(org: string, id: string) {
    const b = await this.get(org, id);
    const input = await this.storage.get(b.object_storage_key);
    const parser = input.pipe(
      parse({
        columns: validateCsvHeaders,
        bom: true,
        skip_empty_lines: true,
        max_record_size: 65536,
      }),
    );
    const sample: Record<string, string>[] = [];
    try {
      for await (const row of parser) {
        sample.push(row as Record<string, string>);
        if (sample.length === 5) break;
      }
    } finally {
      input.destroy();
      parser.destroy();
    }
    return { headers: Object.keys(sample[0] ?? {}), sample };
  }
  async confirm(
    org: string,
    user: string,
    id: string,
    mapping: Record<string, string>,
  ) {
    if (
      Object.keys(mapping).length > 30 ||
      Object.entries(mapping).some(
        ([k, v]) =>
          k.length > 100 ||
          typeof v !== "string" ||
          v.length > 200 ||
          ["__proto__", "constructor", "prototype"].includes(k),
      )
    )
      throw new BadRequestException("Invalid column mapping");
    return this.db.transaction(async (db) => {
      const b = await one<Batch>(
        db,
        "SELECT * FROM import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [org, id],
      );
      if (!b) throw new NotFoundException();
      if (b.status !== "UPLOADED") return { id, status: b.status };
      await db.query(
        "UPDATE import_batches SET status='QUEUED',column_mapping=$3 WHERE organization_id=$1 AND id=$2",
        [org, id, JSON.stringify(mapping)],
      );
      await enqueue(db, org, "IMPORT", id);
      await audit(db, org, user, "IMPORT_CONFIRMED", "import", id);
      return { id, status: "QUEUED" };
    });
  }
  async process(
    org: string,
    id: string,
    progress: (n: number) => Promise<void> = async () => {},
  ) {
    const batch = await this.get(org, id);
    if (batch.status === "COMPLETED") return;
    await this.db.transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        org,
      ]);
      const locked = await one<Batch>(
        db,
        "SELECT * FROM import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [org, id],
      );
      if (locked?.status === "COMPLETED") return;
      await db.query(
        "UPDATE import_batches SET status='PROCESSING',failure_reason=NULL WHERE organization_id=$1 AND id=$2",
        [org, id],
      );
      const stream = await this.storage.get(batch.object_storage_key);
      const parser = stream.pipe(
        parse({
          columns: validateCsvHeaders,
          bom: true,
          skip_empty_lines: true,
          max_record_size: 65536,
          relax_column_count: false,
        }),
      );
      let count = 0;
      let chunk: ParsedRow[] = [];
      try {
        for await (const value of parser) {
          if (++count > getConfig().IMPORT_MAX_ROWS)
            throw new Error("Import exceeds row limit");
          const raw = value as Record<string, string>;
          let normalized: unknown = null;
          let errors: string[] = [];
          const mapped: Record<string, string> = { ...raw };
          for (const [target, source] of Object.entries(batch.column_mapping))
            mapped[target] = raw[source] ?? "";
          try {
            if (batch.import_type === "APPLICATION_USAGE") {
              if (!["true", "false"].includes(mapped.billable ?? ""))
                throw new Error("billable must be true or false");
              normalized = normalizeUsageEvent({
                ...mapped,
                billable: mapped.billable === "true",
                schemaVersion: 1,
              });
            } else if (batch.import_type === "BILLING_USAGE")
              normalized = summarySchema.parse(mapped);
            else
              normalized = lineSchema.parse({
                ...mapped,
                quantity: mapped.quantity || null,
                providerPriceId: mapped.providerPriceId || null,
              });
          } catch (e) {
            errors = [e instanceof Error ? e.message : "Invalid row"];
          }
          chunk.push({
            id: randomUUID(),
            row: count,
            raw,
            normalized,
            status: errors.length ? "REJECTED" : "ACCEPTED",
            errors,
          });
          if (chunk.length >= 1000) {
            await this.persistChunk(db, batch, chunk);
            chunk = [];
            await progress(count);
          }
        }
        if (chunk.length) await this.persistChunk(db, batch, chunk);
        if (!count) throw new Error("CSV contains no data rows");
        await db.query(
          `UPDATE import_batches SET status='COMPLETED',completed_at=now(),total_rows=$3,accepted_rows=(SELECT count(*) FROM raw_import_records WHERE batch_id=$2 AND validation_status='ACCEPTED'),rejected_rows=(SELECT count(*) FROM raw_import_records WHERE batch_id=$2 AND validation_status='REJECTED'),duplicate_rows=(SELECT count(*) FROM raw_import_records WHERE batch_id=$2 AND validation_status='DUPLICATE') WHERE organization_id=$1 AND id=$2`,
          [org, id, count],
        );
      } finally {
        stream.destroy();
        parser.destroy();
      }
    });
  }
  private async persistChunk(db: EntityManager, b: Batch, chunk: ParsedRow[]) {
    const existing = new Map<
      string,
      { id: string; payload: NormalizedUsageEvent }
    >();
    if (b.import_type === "APPLICATION_USAGE") {
      const ids = chunk
        .filter((r) => r.status === "ACCEPTED")
        .map((r) => (r.normalized as NormalizedUsageEvent).eventId);
      for (const e of await rows<{
        id: string;
        source_event_id: string;
        payload: NormalizedUsageEvent;
      }>(
        db,
        "SELECT id,source_event_id,payload FROM usage_events WHERE organization_id=$1 AND source_event_id=ANY($2::text[])",
        [b.organization_id, ids],
      ))
        existing.set(e.source_event_id, e);
    }
    const events: {
      id: string;
      rawId: string;
      payload: NormalizedUsageEvent;
    }[] = [];
    const refs = new Set<string>();
    for (const r of chunk) {
      if (r.status !== "ACCEPTED" || b.import_type !== "APPLICATION_USAGE")
        continue;
      const event = r.normalized as NormalizedUsageEvent;
      const old = existing.get(event.eventId);
      if (old) {
        if (isDeepStrictEqual(old.payload, event)) {
          r.status = "DUPLICATE";
          refs.add(old.id);
        } else {
          r.status = "REJECTED";
          r.errors = [
            "Conflicting duplicate eventId; immutable original retained",
          ];
        }
      } else {
        const id = randomUUID();
        existing.set(event.eventId, { id, payload: event });
        events.push({ id, rawId: r.id, payload: event });
        refs.add(id);
      }
    }
    await db.query(
      `INSERT INTO raw_import_records(id,organization_id,batch_id,row_number,raw_payload,normalized_payload,validation_status,validation_errors) SELECT x.id,$1,$2,x.row,x.raw,x.normalized,x.status,x.errors FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,row integer,raw jsonb,normalized jsonb,status text,errors jsonb)`,
      [b.organization_id, b.id, JSON.stringify(chunk)],
    );
    if (events.length)
      await db.query(
        `INSERT INTO usage_events(id,organization_id,import_batch_id,raw_record_id,source_event_id,source_customer_id,metric_key,quantity,unit,occurred_at,is_billable,payload) SELECT x.id,$1,$2,x."rawId",x.payload->>'eventId',x.payload->>'sourceCustomerId',x.payload->>'metricKey',(x.payload->>'quantity')::numeric,x.payload->>'unit',(x.payload->>'occurredAt')::timestamptz,(x.payload->>'billable')::boolean,x.payload FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,"rawId" uuid,payload jsonb)`,
        [b.organization_id, b.id, JSON.stringify(events)],
      );
    if (refs.size)
      await db.query(
        "INSERT INTO import_event_refs(organization_id,batch_id,event_id) SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT DO NOTHING",
        [b.organization_id, b.id, [...refs]],
      );
  }
}

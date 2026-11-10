import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { IsUUID } from "class-validator";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import { csvRow } from "@usageaudit/provider-adapters";
import { AuthRequest, Permission } from "../../common/security";
import { DB, audit, enqueue, one, rows } from "../../common/database";
import { Storage } from "../../common/storage";
interface Report {
  id: string;
  reconciliation_run_id: string;
  status: string;
  object_storage_key: string | null;
}
class ReportDto {
  @IsUUID() reconciliationRunId!: string;
}
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private db: DataSource,
    @Inject(Storage) private storage: Storage,
  ) {}
  async create(org: string, user: string, run: string) {
    return this.db.transaction(async (db) => {
      const existing = await one<{ status: string }>(
        db,
        "SELECT status FROM reconciliation_runs WHERE organization_id=$1 AND id=$2",
        [org, run],
      );
      if (!existing) throw new NotFoundException();
      if (existing.status !== "COMPLETED")
        throw new BadRequestException("Run must be completed");
      const id = randomUUID();
      await db.query(
        "INSERT INTO reports(id,organization_id,reconciliation_run_id,generated_by) VALUES($1,$2,$3,$4)",
        [id, org, run, user],
      );
      await enqueue(db, org, "REPORT", id);
      await audit(db, org, user, "REPORT_REQUESTED", "report", id);
      return { id, status: "QUEUED" };
    });
  }
  async process(org: string, id: string) {
    const report = await this.get(org, id);
    if (report.status === "COMPLETED") return;
    const findings = await rows<Record<string, unknown>>(
      this.db,
      "SELECT * FROM reconciliation_findings WHERE organization_id=$1 AND run_id=$2 ORDER BY customer_identifier,metric_key,finding_type",
      [org, report.reconciliation_run_id],
    );
    const cols = [
      "id",
      "customer_identifier",
      "metric_key",
      "finding_type",
      "evidence_status",
      "review_status",
      "expected_quantity",
      "actual_quantity",
      "expected_amount",
      "actual_amount",
      "variance_amount",
      "currency",
    ];
    const contents =
      csvRow(["run_id", ...cols]) +
      findings
        .map((f) =>
          csvRow([report.reconciliation_run_id, ...cols.map((c) => f[c])]),
        )
        .join("");
    const key = `${org}/reports/${id}.csv`;
    await this.storage.initialize();
    await this.storage.put(
      key,
      Readable.from([contents]),
      Buffer.byteLength(contents),
    );
    await this.db.query(
      "UPDATE reports SET status='COMPLETED',object_storage_key=$3,completed_at=now(),failure_reason=NULL WHERE organization_id=$1 AND id=$2",
      [org, id, key],
    );
  }
  async get(org: string, id: string) {
    const r = await one<Report>(
      this.db,
      "SELECT * FROM reports WHERE organization_id=$1 AND id=$2",
      [org, id],
    );
    if (!r) throw new NotFoundException();
    return r;
  }
  async download(org: string, id: string, res: Response) {
    const r = await this.get(org, id);
    if (r.status !== "COMPLETED" || !r.object_storage_key)
      throw new BadRequestException("Report is not ready");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="usageaudit-${id}.csv"`,
    );
    await pipeline(await this.storage.get(r.object_storage_key), res);
  }
}
@Permission("read")
@Controller("reports")
export class ReportsController {
  constructor(
    @Inject(ReportsService) private service: ReportsService,
    @Inject(DB) private db: DataSource,
  ) {}
  @Get() list(@Req() r: AuthRequest) {
    return rows(
      this.db,
      "SELECT id,reconciliation_run_id,status,created_at,completed_at,failure_reason FROM reports WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100",
      [r.organizationId],
    );
  }
  @Post() @HttpCode(202) create(@Req() r: AuthRequest, @Body() d: ReportDto) {
    return this.service.create(
      r.organizationId,
      r.principal.id,
      d.reconciliationRunId,
    );
  }
  @Get(":id") detail(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.get(r.organizationId, id);
  }
  @Get(":id/download") download(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    return this.service.download(r.organizationId, id, res);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { IsBoolean, IsISO8601, IsUUID } from "class-validator";
import { DataSource } from "typeorm";
import { DB, audit, one, rows } from "../../common/database";
import { AuthRequest, Permission } from "../../common/security";
import { RunDto } from "../reconciliation/reconciliation.controller";
import { ReconciliationService } from "../reconciliation/reconciliation.service";
class ScheduleDto extends RunDto {
  @IsISO8601() nextRunAt!: string;
}
class EnabledDto {
  @IsBoolean() enabled!: boolean;
}
class RetryDto {
  @IsUUID() jobId!: string;
}
@Permission("read")
@Controller()
export class OperationsController {
  constructor(
    @Inject(DB) private db: DataSource,
    @Inject(ReconciliationService) private runs: ReconciliationService,
  ) {}
  @Get("jobs") jobs(@Req() r: AuthRequest) {
    return rows(
      this.db,
      "SELECT id,kind,resource_id,status,attempts,error,updated_at FROM job_outbox WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100",
      [r.organizationId],
    );
  }
  @Permission("write") @Post("jobs/retry") retry(
    @Req() r: AuthRequest,
    @Body() d: RetryDto,
  ) {
    return this.db.transaction(async (db) => {
      const job = await one<{ status: string }>(
        db,
        "SELECT status FROM job_outbox WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [r.organizationId, d.jobId],
      );
      if (!job) throw new NotFoundException();
      if (job.status !== "FAILED")
        throw new BadRequestException("Only failed jobs can be retried");
      await db.query(
        "UPDATE job_outbox SET status='PENDING',attempts=0,error=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2",
        [r.organizationId, d.jobId],
      );
      await audit(
        db,
        r.organizationId,
        r.principal.id,
        "JOB_RETRIED",
        "job",
        d.jobId,
      );
      return { ok: true };
    });
  }
  @Get("schedules") schedules(@Req() r: AuthRequest) {
    return rows(
      this.db,
      "SELECT * FROM reconciliation_schedules WHERE organization_id=$1 ORDER BY created_at DESC",
      [r.organizationId],
    );
  }
  @Permission("configure") @Post("schedules") async schedule(
    @Req() r: AuthRequest,
    @Body() d: ScheduleDto,
  ) {
    await this.runs.readiness(r.organizationId, d);
    return one(
      this.db,
      "INSERT INTO reconciliation_schedules(organization_id,source_import_batch_id,provider_snapshot_id,period_start,period_end,next_run_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        r.organizationId,
        d.sourceImportBatchId,
        d.providerSnapshotId,
        d.periodStart,
        d.periodEnd,
        d.nextRunAt,
        r.principal.id,
      ],
    );
  }
  @Permission("configure") @Post("schedules/:id") async enable(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: EnabledDto,
  ) {
    const result = await one(
      this.db,
      "UPDATE reconciliation_schedules SET enabled=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *",
      [r.organizationId, id, d.enabled],
    );
    if (!result) throw new NotFoundException();
    return result;
  }
  @Get("audit-logs") logs(@Req() r: AuthRequest) {
    return rows(
      this.db,
      "SELECT * FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100",
      [r.organizationId],
    );
  }
}

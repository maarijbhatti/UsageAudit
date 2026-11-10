import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { IsISO8601, IsString, IsUUID, Length } from "class-validator";
import { DataSource } from "typeorm";
import { AuthRequest, Permission } from "../../common/security";
import { DB, one, rows } from "../../common/database";
import { PageDto } from "../../common/pagination";
import { ReconciliationService } from "./reconciliation.service";
import { SnapshotsService } from "../connections/snapshots.service";
export class RunDto {
  @IsISO8601({ strict: true }) periodStart!: string;
  @IsISO8601({ strict: true }) periodEnd!: string;
  @IsUUID() sourceImportBatchId!: string;
  @IsUUID() providerSnapshotId!: string;
  @IsString() @Length(1, 200) requestKey!: string;
}
class SnapshotDto {
  @IsUUID() usageImportId!: string;
  @IsUUID() invoiceImportId!: string;
}
@Permission("read")
@Controller()
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService) private service: ReconciliationService,
    @Inject(SnapshotsService) private snapshots: SnapshotsService,
    @Inject(DB) private db: DataSource,
  ) {}
  @Get("provider-snapshots") snapshotsList(@Req() r: AuthRequest) {
    return rows(
      this.db,
      "SELECT id,snapshot_type,status,fetched_at,source_reference FROM provider_snapshots WHERE organization_id=$1 ORDER BY fetched_at DESC LIMIT 100",
      [r.organizationId],
    );
  }
  @Permission("write") @Post("provider-snapshots") snapshot(
    @Req() r: AuthRequest,
    @Body() d: SnapshotDto,
  ) {
    return this.snapshots.fromImports(
      r.organizationId,
      d.usageImportId,
      d.invoiceImportId,
    );
  }
  @Permission("write") @Post("reconciliation-runs/readiness") readiness(
    @Req() r: AuthRequest,
    @Body() d: RunDto,
  ) {
    return this.service.readiness(r.organizationId, d);
  }
  @Permission("write") @Post("reconciliation-runs") @HttpCode(202) create(
    @Req() r: AuthRequest,
    @Body() d: RunDto,
  ) {
    return this.service.create(r.organizationId, r.principal.id, d);
  }
  @Get("reconciliation-runs") async list(
    @Req() r: AuthRequest,
    @Query() p: PageDto,
  ) {
    const items = await rows(
      this.db,
      "SELECT id,period_start,period_end,status,created_at,completed_at,failure_reason FROM reconciliation_runs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [r.organizationId, p.pageSize, (p.page - 1) * p.pageSize],
    );
    const c = await one<{ total: number }>(
      this.db,
      "SELECT count(*)::int AS total FROM reconciliation_runs WHERE organization_id=$1",
      [r.organizationId],
    );
    return { items, total: c!.total, ...p };
  }
  @Get("reconciliation-runs/:id") detail(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.get(r.organizationId, id);
  }
  @Get("reconciliation-runs/:id/findings") async findings(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() p: PageDto,
  ) {
    await this.service.get(r.organizationId, id);
    return {
      items: await rows(
        this.db,
        "SELECT id,customer_identifier,metric_key,finding_type,evidence_status,review_status,variance_amount,currency FROM reconciliation_findings WHERE organization_id=$1 AND run_id=$2 ORDER BY created_at,id LIMIT $3 OFFSET $4",
        [r.organizationId, id, p.pageSize, (p.page - 1) * p.pageSize],
      ),
      ...p,
    };
  }
}

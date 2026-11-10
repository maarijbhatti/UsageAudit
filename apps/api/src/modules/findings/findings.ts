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
  Query,
  Req,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, Length } from "class-validator";
import { DataSource } from "typeorm";
import type { ReviewStatus } from "@usageaudit/shared-types";
import { AuthRequest, Permission } from "../../common/security";
import { DB, audit, one, rows } from "../../common/database";
import { PageDto } from "../../common/pagination";
import { ReconciliationService } from "../reconciliation/reconciliation.service";
class FindingQuery extends PageDto {
  @IsOptional() @IsString() @Length(0, 100) search?: string;
  @IsOptional()
  @IsIn(["OPEN", "INVESTIGATING", "CONFIRMED", "DISMISSED", "RESOLVED"])
  status?: ReviewStatus;
}
class ReviewDto {
  @IsIn(["OPEN", "INVESTIGATING", "CONFIRMED", "DISMISSED", "RESOLVED"])
  newStatus!: ReviewStatus;
  @IsString() @Length(3, 2000) comment!: string;
}
interface Finding {
  id: string;
  run_id: string;
  customer_identifier: string;
  metric_key: string;
  review_status: ReviewStatus;
  evidence_status: string;
}
const transitions: Record<ReviewStatus, ReviewStatus[]> = {
  OPEN: ["INVESTIGATING", "CONFIRMED", "DISMISSED"],
  INVESTIGATING: ["OPEN", "CONFIRMED", "DISMISSED", "RESOLVED"],
  CONFIRMED: ["INVESTIGATING", "RESOLVED"],
  DISMISSED: ["OPEN"],
  RESOLVED: ["OPEN"],
};
@Permission("read")
@Controller("findings")
export class FindingsController {
  constructor(
    @Inject(DB) private db: DataSource,
    @Inject(ReconciliationService) private runs: ReconciliationService,
  ) {}
  @Get() async list(@Req() r: AuthRequest, @Query() p: FindingQuery) {
    const where =
      "organization_id=$1 AND ($2::text IS NULL OR review_status=$2) AND ($3::text IS NULL OR customer_identifier ILIKE $3 OR metric_key ILIKE $3 OR finding_type ILIKE $3)";
    const args = [
      r.organizationId,
      p.status ?? null,
      p.search ? "%" + p.search + "%" : null,
    ];
    const items = await rows(
      this.db,
      `SELECT id,run_id,customer_identifier,metric_key,finding_type,severity,evidence_status,review_status,expected_quantity,actual_quantity,expected_amount,actual_amount,variance_amount,currency,created_at FROM reconciliation_findings WHERE ${where} ORDER BY created_at DESC,id LIMIT $4 OFFSET $5`,
      [...args, p.pageSize, (p.page - 1) * p.pageSize],
    );
    const c = await one<{ total: number }>(
      this.db,
      `SELECT count(*)::int AS total FROM reconciliation_findings WHERE ${where}`,
      args,
    );
    return { items, total: c!.total, page: p.page, pageSize: p.pageSize };
  }
  @Get(":id") async detail(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const finding = await one<Finding>(
      this.db,
      "SELECT * FROM reconciliation_findings WHERE organization_id=$1 AND id=$2",
      [r.organizationId, id],
    );
    if (!finding) throw new NotFoundException();
    const reviews = await rows(
      this.db,
      "SELECT r.*,u.display_name AS reviewer FROM finding_reviews r JOIN users u ON u.id=r.reviewed_by WHERE r.organization_id=$1 AND r.finding_id=$2 ORDER BY r.created_at",
      [r.organizationId, id],
    );
    return {
      ...finding,
      reviews,
      inputs: await this.runs.evidence(
        r.organizationId,
        finding.run_id,
        finding.customer_identifier,
        finding.metric_key,
      ),
    };
  }
  @Permission("write") @Post(":id/reviews") review(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: ReviewDto,
  ) {
    return this.db.transaction(async (db) => {
      const f = await one<Finding>(
        db,
        "SELECT * FROM reconciliation_findings WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [r.organizationId, id],
      );
      if (!f) throw new NotFoundException();
      if (!transitions[f.review_status].includes(d.newStatus))
        throw new BadRequestException("Invalid review status transition");
      if (d.newStatus === "CONFIRMED" && f.evidence_status !== "COMPLETE")
        throw new BadRequestException(
          "Complete evidence is required before confirmation",
        );
      await db.query(
        "INSERT INTO finding_reviews(organization_id,finding_id,reviewed_by,previous_status,new_status,comment) VALUES($1,$2,$3,$4,$5,$6)",
        [
          r.organizationId,
          id,
          r.principal.id,
          f.review_status,
          d.newStatus,
          d.comment,
        ],
      );
      await db.query(
        "UPDATE reconciliation_findings SET review_status=$3,updated_at=now() WHERE organization_id=$1 AND id=$2",
        [r.organizationId, id, d.newStatus],
      );
      await audit(
        db,
        r.organizationId,
        r.principal.id,
        "FINDING_REVIEWED",
        "finding",
        id,
        { previousStatus: f.review_status, newStatus: d.newStatus },
      );
      return { id, reviewStatus: d.newStatus };
    });
  }
}

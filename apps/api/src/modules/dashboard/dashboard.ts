import { Controller, Get, Inject, Req } from "@nestjs/common";
import { DataSource } from "typeorm";
import { AuthRequest, Permission } from "../../common/security";
import { DB, one, rows } from "../../common/database";
@Permission("read")
@Controller("dashboard")
export class DashboardController {
  constructor(@Inject(DB) private db: DataSource) {}
  @Get("overview") async overview(@Req() r: AuthRequest) {
    const org = r.organizationId;
    const latest = await one<{ id: string }>(
      this.db,
      "SELECT id FROM reconciliation_runs WHERE organization_id=$1 AND status='COMPLETED' ORDER BY created_at DESC LIMIT 1",
      [org],
    );
    const totals = latest
      ? await rows(
          this.db,
          `SELECT c->>'currency' AS currency,coalesce(sum((c->>'actualAmount')::numeric),0)::text AS audited_amount,coalesce(sum(greatest((c->>'varianceAmount')::numeric,0)) FILTER(WHERE c->>'evidenceStatus'='COMPLETE'),0)::text AS potential_underbilling,coalesce(sum(greatest(-(c->>'varianceAmount')::numeric,0)) FILTER(WHERE c->>'evidenceStatus'='COMPLETE'),0)::text AS potential_overbilling,count(*)::int AS components,count(*) FILTER(WHERE c->>'evidenceStatus'='COMPLETE')::int AS complete_components FROM reconciliation_runs r CROSS JOIN LATERAL jsonb_array_elements(r.result_summary) c WHERE r.organization_id=$1 AND r.id=$2 GROUP BY c->>'currency'`,
          [org, latest.id],
        )
      : [];
    const counts = await one(
      this.db,
      "SELECT count(*) FILTER(WHERE review_status IN ('OPEN','INVESTIGATING'))::int AS open_findings,count(*) FILTER(WHERE review_status='CONFIRMED')::int AS confirmed_findings FROM reconciliation_findings WHERE organization_id=$1",
      [org],
    );
    const imports = await one(
      this.db,
      "SELECT max(completed_at) AS last_import FROM import_batches WHERE organization_id=$1",
      [org],
    );
    const connections = await rows(
      this.db,
      "SELECT id,display_name,provider,status,last_synced_at FROM connections WHERE organization_id=$1",
      [org],
    );
    return {
      latestRunId: latest?.id ?? null,
      totals,
      counts,
      imports,
      connections,
    };
  }
  @Get("exception-summary") summary(@Req() r: AuthRequest) {
    return rows(
      this.db,
      "SELECT finding_type,count(*)::int AS count FROM reconciliation_findings WHERE organization_id=$1 GROUP BY finding_type ORDER BY count(*) DESC",
      [r.organizationId],
    );
  }
  @Get("reconciliation-history") history(@Req() r: AuthRequest) {
    return rows(
      this.db,
      "SELECT id,period_start,period_end,status,created_at FROM reconciliation_runs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 8",
      [r.organizationId],
    );
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { IsISO8601, IsString, Length, Matches } from "class-validator";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { SecretEncryption } from "../../common/secrets";
import { StripeAdapter } from "@usageaudit/provider-adapters";
import { DB, audit, enqueue, one, rows } from "../../common/database";
import { AuthRequest, Permission } from "../../common/security";
import { ConfigurationService, validatePeriod } from "../pricing/configuration";
import { SnapshotsService } from "./snapshots.service";
class ConnectionDto {
  @IsString() @Length(1, 100) displayName!: string;
  @Matches(/^rk_(test|live)_[A-Za-z0-9]+$/) secretKey!: string;
}
class SyncDto {
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
}
interface Connection {
  id: string;
  provider: string;
  status: string;
  encrypted_secret_reference: string | null;
}
@Injectable()
export class ConnectionsService {
  private encryption = new SecretEncryption();
  constructor(
    @Inject(DB) private db: DataSource,
    @Inject(ConfigurationService) private config: ConfigurationService,
    @Inject(SnapshotsService) private snapshots: SnapshotsService,
  ) {}
  async get(org: string, id: string) {
    const c = await one<Connection>(
      this.db,
      "SELECT * FROM connections WHERE organization_id=$1 AND id=$2",
      [org, id],
    );
    if (!c) throw new NotFoundException();
    return c;
  }
  private adapter(c: Connection, org: string) {
    if (c.status === "REVOKED" || !c.encrypted_secret_reference)
      throw new BadRequestException("Connection is revoked");
    return new StripeAdapter(
      this.encryption.decrypt(c.encrypted_secret_reference, org),
    );
  }
  async create(org: string, user: string, d: ConnectionDto) {
    const result = await new StripeAdapter(d.secretKey).testConnection();
    return this.db.transaction(async (db) => {
      const c = await one<{ id: string }>(
        db,
        "INSERT INTO connections(organization_id,provider,environment,display_name,encrypted_secret_reference) VALUES($1,'STRIPE',$2,$3,$4) RETURNING id,provider,environment,display_name,status",
        [
          org,
          result.environment,
          d.displayName,
          this.encryption.encrypt(d.secretKey, org),
        ],
      );
      await audit(db, org, user, "CONNECTION_CREATED", "connection", c!.id);
      return c;
    });
  }
  async test(org: string, id: string) {
    try {
      const result = await this.adapter(
        await this.get(org, id),
        org,
      ).testConnection();
      await this.db.query(
        "UPDATE connections SET status='ACTIVE',updated_at=now() WHERE organization_id=$1 AND id=$2",
        [org, id],
      );
      return result;
    } catch {
      await this.db.query(
        "UPDATE connections SET status='ERROR',updated_at=now() WHERE organization_id=$1 AND id=$2 AND status<>'REVOKED'",
        [org, id],
      );
      throw new BadRequestException(
        "Stripe read permissions or credentials could not be verified",
      );
    }
  }
  async rotate(org: string, user: string, id: string, d: ConnectionDto) {
    await this.get(org, id);
    await new StripeAdapter(d.secretKey).testConnection();
    await this.db.transaction(async (db) => {
      await db.query(
        "UPDATE connections SET encrypted_secret_reference=$3,environment=$4,status='ACTIVE',updated_at=now() WHERE organization_id=$1 AND id=$2",
        [
          org,
          id,
          this.encryption.encrypt(d.secretKey, org),
          d.secretKey.startsWith("rk_live_") ? "live" : "test",
        ],
      );
      await audit(db, org, user, "CONNECTION_ROTATED", "connection", id);
    });
    return { ok: true };
  }
  async sync(org: string, user: string, id: string, d: SyncDto) {
    validatePeriod(d.periodStart, d.periodEnd);
    const c = await this.get(org, id);
    this.adapter(c, org);
    const jobId = randomUUID();
    await this.db.transaction(async (db) => {
      await enqueue(db, org, "STRIPE_SYNC", jobId, { connectionId: id, ...d });
      await audit(db, org, user, "STRIPE_SYNC_REQUESTED", "connection", id);
    });
    return { id: jobId, status: "QUEUED" };
  }
  async process(org: string, jobId: string, payload: Record<string, unknown>) {
    if (
      await one(
        this.db,
        "SELECT id FROM provider_snapshots WHERE organization_id=$1 AND id=$2",
        [org, jobId],
      )
    )
      return;
    const id = String(payload.connectionId);
    const c = await this.get(org, id),
      cfg = await this.config.snapshot(org);
    const snapshot = await this.adapter(c, org).fetchSnapshot({
      snapshotId: jobId,
      observedAt: new Date().toISOString(),
      periodStart: String(payload.periodStart),
      periodEnd: String(payload.periodEnd),
      customers: [
        ...new Set(cfg.customerMappings.map((m) => m.providerCustomerId)),
      ],
      meters: [...new Set(cfg.metricMappings.map((m) => m.providerMeterId))],
    });
    await this.snapshots.persist(org, snapshot, id, { jobId });
    await this.db.query(
      "UPDATE connections SET last_synced_at=now(),status=$3 WHERE organization_id=$1 AND id=$2",
      [org, id, "ACTIVE"],
    );
  }
}
@Permission("read")
@Controller("connections")
export class ConnectionsController {
  constructor(
    @Inject(DB) private db: DataSource,
    @Inject(ConnectionsService) private service: ConnectionsService,
  ) {}
  @Get() list(@Req() r: AuthRequest) {
    return rows(
      this.db,
      "SELECT id,provider,environment,display_name,status,last_synced_at,created_at FROM connections WHERE organization_id=$1 ORDER BY created_at DESC",
      [r.organizationId],
    );
  }
  @Permission("configure") @Post("stripe") create(
    @Req() r: AuthRequest,
    @Body() d: ConnectionDto,
  ) {
    return this.service.create(r.organizationId, r.principal.id, d);
  }
  @Permission("configure") @Post(":id/test") test(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.test(r.organizationId, id);
  }
  @Permission("configure") @Post(":id/rotate") rotate(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: ConnectionDto,
  ) {
    return this.service.rotate(r.organizationId, r.principal.id, id, d);
  }
  @Permission("configure") @Post(":id/sync") @HttpCode(202) sync(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: SyncDto,
  ) {
    return this.service.sync(r.organizationId, r.principal.id, id, d);
  }
  @Permission("configure") @Delete(":id") async revoke(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.service.get(r.organizationId, id);
    await this.db.transaction(async (db) => {
      await db.query(
        "UPDATE connections SET encrypted_secret_reference=NULL,status='REVOKED',updated_at=now() WHERE organization_id=$1 AND id=$2",
        [r.organizationId, id],
      );
      await audit(
        db,
        r.organizationId,
        r.principal.id,
        "CONNECTION_REVOKED",
        "connection",
        id,
      );
    });
    return { ok: true };
  }
}

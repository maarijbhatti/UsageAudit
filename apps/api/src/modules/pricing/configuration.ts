import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import type {
  CustomerMapping,
  MetricMapping,
  FlatUnitPricingRule,
} from "@usageaudit/shared-types";
import { currencyDigits } from "@usageaudit/billing-core";
import { DB, audit, one, rows } from "../../common/database";
import { AuthRequest, Permission } from "../../common/security";
class EffectiveDto {
  @IsISO8601({ strict: true }) effectiveFrom!: string;
  @IsOptional() @IsISO8601({ strict: true }) effectiveTo?: string;
}
export class CustomerDto extends EffectiveDto {
  @IsString() @Length(1, 200) sourceCustomerId!: string;
  @IsString() @Length(1, 200) providerCustomerId!: string;
}
export class MetricDto extends EffectiveDto {
  @IsString() @Length(1, 100) sourceMetricKey!: string;
  @IsString() @Length(1, 200) providerMeterId!: string;
  @IsIn(["SUM"]) aggregationMethod!: "SUM";
}
export class PricingDto extends EffectiveDto {
  @IsString() @Length(1, 100) metricKey!: string;
  @IsString() @Length(1, 200) providerPriceId!: string;
  @IsIn(["FLAT_PER_UNIT"]) pricingModel!: "FLAT_PER_UNIT";
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @Matches(/^(0|[1-9]\d{0,19})(\.\d{1,18})?$/) unitPrice!: string;
  @IsOptional() @IsUUID() customerMappingId?: string;
}
export function validatePeriod(from: string, to?: string | null) {
  if (
    !from.endsWith("Z") ||
    (to && !to.endsWith("Z")) ||
    !Number.isFinite(Date.parse(from)) ||
    (to && Date.parse(from) >= Date.parse(to))
  )
    throw new BadRequestException("Use a UTC interval with end after start");
}
@Injectable()
export class ConfigurationService {
  constructor(@Inject(DB) private db: DataSource) {}
  async snapshot(org: string, db: DataSource | EntityManager = this.db) {
    const customers = await rows<CustomerMapping>(
      db,
      'SELECT id,source_customer_id AS "sourceCustomerId",provider_customer_id AS "providerCustomerId",effective_from AS "effectiveFrom",effective_to AS "effectiveTo" FROM customer_mappings WHERE organization_id=$1 ORDER BY effective_from,id',
      [org],
    );
    const metrics = await rows<MetricMapping>(
      db,
      'SELECT id,source_metric_key AS "sourceMetricKey",provider_meter_id AS "providerMeterId",aggregation_method AS "aggregationMethod",effective_from AS "effectiveFrom",effective_to AS "effectiveTo" FROM metric_mappings WHERE organization_id=$1 ORDER BY effective_from,id',
      [org],
    );
    const pricing = await rows<FlatUnitPricingRule>(
      db,
      'SELECT id,metric_key AS "metricKey",provider_price_id AS "providerPriceId",customer_mapping_id AS "customerMappingId",pricing_model AS "pricingModel",currency,unit_price AS "unitPrice",version,effective_from AS "effectiveFrom",effective_to AS "effectiveTo" FROM pricing_rules WHERE organization_id=$1 ORDER BY version',
      [org],
    );
    return JSON.parse(
      JSON.stringify({
        customerMappings: customers,
        metricMappings: metrics,
        pricing,
      }),
    ) as {
      customerMappings: CustomerMapping[];
      metricMappings: MetricMapping[];
      pricing: FlatUnitPricingRule[];
    };
  }
  async customer(org: string, user: string, d: CustomerDto) {
    validatePeriod(d.effectiveFrom, d.effectiveTo);
    return this.db.transaction(async (db) => {
      const r = await one<{ id: string }>(
        db,
        "INSERT INTO customer_mappings(organization_id,source_customer_id,provider_customer_id,effective_from,effective_to) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          org,
          d.sourceCustomerId,
          d.providerCustomerId,
          d.effectiveFrom,
          d.effectiveTo ?? null,
        ],
      );
      await audit(
        db,
        org,
        user,
        "CUSTOMER_MAPPING_CREATED",
        "customer_mapping",
        r!.id,
      );
      return r;
    });
  }
  async metric(org: string, user: string, d: MetricDto) {
    validatePeriod(d.effectiveFrom, d.effectiveTo);
    return this.db.transaction(async (db) => {
      const r = await one<{ id: string }>(
        db,
        "INSERT INTO metric_mappings(organization_id,source_metric_key,provider_meter_id,aggregation_method,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          org,
          d.sourceMetricKey,
          d.providerMeterId,
          d.aggregationMethod,
          d.effectiveFrom,
          d.effectiveTo ?? null,
        ],
      );
      await audit(
        db,
        org,
        user,
        "METRIC_MAPPING_CREATED",
        "metric_mapping",
        r!.id,
      );
      return r;
    });
  }
  async price(org: string, user: string, d: PricingDto) {
    validatePeriod(d.effectiveFrom, d.effectiveTo);
    if (currencyDigits[d.currency] === undefined)
      throw new BadRequestException("Unsupported currency");
    return this.db.transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
        org + ":" + d.metricKey,
      ]);
      const latest = await one<{ version: number }>(
        db,
        "SELECT coalesce(max(version),0)::int AS version FROM pricing_rules WHERE organization_id=$1 AND metric_key=$2",
        [org, d.metricKey],
      );
      const r = await one<{ id: string }>(
        db,
        "INSERT INTO pricing_rules(organization_id,metric_key,provider_price_id,customer_mapping_id,pricing_model,currency,unit_price,effective_from,effective_to,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          org,
          d.metricKey,
          d.providerPriceId,
          d.customerMappingId ?? null,
          d.pricingModel,
          d.currency,
          d.unitPrice,
          d.effectiveFrom,
          d.effectiveTo ?? null,
          latest!.version + 1,
        ],
      );
      await audit(
        db,
        org,
        user,
        "PRICING_VERSION_CREATED",
        "pricing_rule",
        r!.id,
      );
      return r;
    });
  }
}
@Permission("read")
@Controller()
export class ConfigurationController {
  constructor(
    @Inject(ConfigurationService) private service: ConfigurationService,
    @Inject(DB) private db: DataSource,
  ) {}
  @Get("customers") customers(@Req() r: AuthRequest) {
    return rows(
      this.db,
      "SELECT source_customer_id,count(*)::int AS events FROM usage_events WHERE organization_id=$1 GROUP BY source_customer_id ORDER BY source_customer_id LIMIT 1000",
      [r.organizationId],
    );
  }
  @Get("customer-mappings") async customerList(@Req() r: AuthRequest) {
    return (await this.service.snapshot(r.organizationId)).customerMappings;
  }
  @Get("metric-mappings") async metricList(@Req() r: AuthRequest) {
    return (await this.service.snapshot(r.organizationId)).metricMappings;
  }
  @Get("pricing-rules") async prices(@Req() r: AuthRequest) {
    return (await this.service.snapshot(r.organizationId)).pricing;
  }
  @Get("pricing-rules/:id") async price(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const p = (await this.service.snapshot(r.organizationId)).pricing.find(
      (p) => p.id === id,
    );
    if (!p) throw new NotFoundException();
    return p;
  }
  @Permission("write") @Post("customer-mappings") createCustomer(
    @Req() r: AuthRequest,
    @Body() d: CustomerDto,
  ) {
    return this.service.customer(r.organizationId, r.principal.id, d);
  }
  @Permission("configure") @Post("metric-mappings") createMetric(
    @Req() r: AuthRequest,
    @Body() d: MetricDto,
  ) {
    return this.service.metric(r.organizationId, r.principal.id, d);
  }
  @Permission("configure") @Post("pricing-rules") createPrice(
    @Req() r: AuthRequest,
    @Body() d: PricingDto,
  ) {
    return this.service.price(r.organizationId, r.principal.id, d);
  }
}

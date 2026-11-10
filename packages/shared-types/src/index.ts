export type Role = "OWNER" | "ADMIN" | "ANALYST" | "VIEWER";
export type ReviewStatus =
  "OPEN" | "INVESTIGATING" | "CONFIRMED" | "DISMISSED" | "RESOLVED";
export type EvidenceStatus =
  "COMPLETE" | "PENDING_DATA" | "INCOMPLETE" | "UNSUPPORTED";
export type FindingType =
  | "MISSING_USAGE"
  | "EXCESS_USAGE"
  | "DUPLICATE_SOURCE_EVENT"
  | "PRICE_MISMATCH"
  | "PERIOD_MISMATCH"
  | "UNMAPPED_CUSTOMER"
  | "UNMAPPED_METRIC"
  | "MISSING_PRICING_RULE"
  | "INCOMPLETE_EVIDENCE"
  | "UNSUPPORTED_BILLING_MODEL";
export interface NormalizedUsageEvent {
  eventId: string;
  sourceCustomerId: string;
  metricKey: string;
  quantity: string;
  unit: string;
  occurredAt: string;
  billable: boolean;
  schemaVersion: number;
  metadata?: Record<string, unknown>;
}
export interface Period {
  periodStart: string;
  periodEnd: string;
}
export interface Effective {
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface CustomerMapping extends Effective {
  id: string;
  sourceCustomerId: string;
  providerCustomerId: string;
}
export interface MetricMapping extends Effective {
  id: string;
  sourceMetricKey: string;
  providerMeterId: string;
  aggregationMethod: "SUM";
}
export interface FlatUnitPricingRule extends Effective {
  id: string;
  metricKey: string;
  currency: string;
  unitPrice: string;
  version: number;
  providerPriceId: string;
  customerMappingId: string | null;
  pricingModel: string;
}
export interface ProviderUsageSummary extends Period {
  providerCustomerId: string;
  providerMeterId: string;
  quantity: string;
  snapshotId: string;
  observedAt: string;
}
export interface ProviderInvoiceLine extends Period {
  id: string;
  invoiceId: string;
  providerCustomerId: string;
  providerPriceId: string | null;
  quantity: string | null;
  amountMinorUnits: string;
  currency: string;
  componentType: "USAGE" | "FIXED" | "TAX" | "DISCOUNT" | "UNSUPPORTED";
  invoiceStatus: string;
  raw?: Record<string, unknown>;
}
export interface ProviderSnapshot {
  id: string;
  observedAt: string;
  complete: boolean;
  summaries: ProviderUsageSummary[];
  lines: ProviderInvoiceLine[];
  limitations: string[];
  raw?: unknown;
}
export interface ReconciliationFinding {
  type: FindingType;
  message: string;
}
export interface ReconciliationResult extends Period {
  customerId: string;
  metricKey: string;
  expectedQuantity: string | null;
  providerQuantity: string | null;
  expectedAmount: string | null;
  actualAmount: string | null;
  varianceAmount: string | null;
  currency: string | null;
  evidenceStatus: EvidenceStatus;
  findings: ReconciliationFinding[];
  evidence: {
    eventIds: string[];
    pricingRuleIds: string[];
    customerMappingIds: string[];
    metricMappingIds: string[];
    providerLineIds: string[];
    limitations: string[];
  };
}
export interface ReconciliationInput extends Period {
  events: NormalizedUsageEvent[];
  customerMappings: CustomerMapping[];
  metricMappings: MetricMapping[];
  pricing: FlatUnitPricingRule[];
  provider: ProviderSnapshot;
  sourceComplete: boolean;
  asOf: string;
  processingDelaySeconds: number;
  duplicateEventIds?: string[];
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

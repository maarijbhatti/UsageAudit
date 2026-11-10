import Decimal from "decimal.js";
import { z } from "zod";
import type {
  CustomerMapping,
  Effective,
  EvidenceStatus,
  FlatUnitPricingRule,
  MetricMapping,
  NormalizedUsageEvent,
  Period,
  ReconciliationFinding,
  ReconciliationInput,
  ReconciliationResult,
} from "@usageaudit/shared-types";
export const ALGORITHM_VERSION = "1.0.0";
const Money = Decimal.clone({
  precision: 100,
  rounding: Decimal.ROUND_HALF_UP,
});
export const currencyDigits: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
  KWD: 3,
  BHD: 3,
};
export const quantitySchema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,29})$/,
    "Quantity must be a nonnegative integer with at most 30 digits",
  );
export const utcSchema = z.iso.datetime({ offset: false });
export const usageSchema = z.object({
  eventId: z.string().min(1).max(200),
  sourceCustomerId: z.string().min(1).max(200),
  metricKey: z.string().min(1).max(100),
  quantity: quantitySchema,
  unit: z.string().min(1).max(50),
  occurredAt: utcSchema,
  billable: z.boolean(),
  schemaVersion: z.literal(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export function validateUsageEvent(value: unknown) {
  return usageSchema.safeParse(value);
}
export function normalizeUsageEvent(value: unknown): NormalizedUsageEvent {
  return usageSchema.parse(value);
}
export function deduplicateUsageEvents(events: NormalizedUsageEvent[]) {
  const seen = new Map<string, NormalizedUsageEvent>();
  const duplicates: string[] = [];
  let conflicting = false;
  for (const e of events) {
    const old = seen.get(e.eventId);
    if (old) {
      duplicates.push(e.eventId);
      if (JSON.stringify(old) !== JSON.stringify(e)) conflicting = true;
    } else seen.set(e.eventId, e);
  }
  return { events: [...seen.values()], duplicates, conflicting };
}
const active = (r: Effective, t: string) =>
  Date.parse(r.effectiveFrom) <= Date.parse(t) &&
  (r.effectiveTo === null || Date.parse(t) < Date.parse(r.effectiveTo));
const unique = <T>(values: T[]): T | undefined => {
  if (values.length > 1)
    throw new Error("Ambiguous effective-dated configuration");
  return values[0];
};
export function resolveCustomerMapping(
  rows: CustomerMapping[],
  id: string,
  time: string,
) {
  return unique(
    rows.filter((r) => r.sourceCustomerId === id && active(r, time)),
  );
}
export function resolveMetricMapping(
  rows: MetricMapping[],
  key: string,
  time: string,
) {
  return unique(
    rows.filter((r) => r.sourceMetricKey === key && active(r, time)),
  );
}
export function resolvePricingRule(
  rows: FlatUnitPricingRule[],
  metric: string,
  mappingId: string | undefined,
  time: string,
) {
  const all = rows.filter((r) => r.metricKey === metric && active(r, time));
  return (
    unique(all.filter((r) => r.customerMappingId === mappingId)) ??
    unique(all.filter((r) => r.customerMappingId === null))
  );
}
export function aggregateUsageByPeriod(
  events: NormalizedUsageEvent[],
  period: Period,
) {
  return events.filter(
    (e) =>
      e.billable &&
      Date.parse(e.occurredAt) >= Date.parse(period.periodStart) &&
      Date.parse(e.occurredAt) < Date.parse(period.periodEnd),
  );
}
export function calculateExpectedCharge(
  parts: { quantity: string; unitPrice: string }[],
  currency: string,
) {
  const digits = currencyDigits[currency];
  if (digits === undefined) throw new Error("Unsupported currency");
  return parts
    .reduce(
      (n, p) => n.plus(new Money(p.quantity).mul(p.unitPrice)),
      new Money(0),
    )
    .toFixed(digits);
}
export function compareUsageQuantities(
  expected: string | null,
  actual: string | null,
): ReconciliationFinding | null {
  if (expected === null || actual === null) return null;
  const delta = new Money(expected).minus(actual);
  return delta.isZero()
    ? null
    : {
        type: delta.isPositive() ? "MISSING_USAGE" : "EXCESS_USAGE",
        message: `Source quantity ${expected}; provider quantity ${actual}. This is a potential discrepancy.`,
      };
}
export function compareInvoiceAmounts(
  expected: string | null,
  actual: string | null,
) {
  return expected === null || actual === null
    ? null
    : new Money(expected).minus(actual).toString();
}
export function classifyDiscrepancy(variance: string | null) {
  return variance === null
    ? "UNKNOWN"
    : new Money(variance).isZero()
      ? "MATCH"
      : new Money(variance).isPositive()
        ? "POTENTIAL_UNDERBILLING"
        : "POTENTIAL_OVERBILLING";
}
export function assessEvidenceCompleteness(
  unsupported: boolean,
  pending: boolean,
  incomplete: boolean,
): EvidenceStatus {
  return unsupported
    ? "UNSUPPORTED"
    : pending
      ? "PENDING_DATA"
      : incomplete
        ? "INCOMPLETE"
        : "COMPLETE";
}

export function generateReconciliationResult(
  input: ReconciliationInput,
): ReconciliationResult[] {
  if (
    !utcSchema.safeParse(input.periodStart).success ||
    !utcSchema.safeParse(input.periodEnd).success ||
    Date.parse(input.periodStart) >= Date.parse(input.periodEnd)
  )
    throw new Error("Invalid UTC half-open billing period");
  const dedup = deduplicateUsageEvents(input.events.map(normalizeUsageEvent));
  const events = aggregateUsageByPeriod(dedup.events, input);
  const groups = new Map<string, NormalizedUsageEvent[]>();
  for (const e of events) {
    const key = JSON.stringify([e.sourceCustomerId, e.metricKey]);
    const group = groups.get(key) ?? [];
    group.push(e);
    groups.set(key, group);
  }
  // Include provider-only components when reverse mappings establish the source identity.
  for (const summary of input.provider.summaries) {
    for (const cm of input.customerMappings.filter(
      (m) =>
        m.providerCustomerId === summary.providerCustomerId &&
        active(m, input.periodStart),
    )) {
      for (const mm of input.metricMappings.filter(
        (m) =>
          m.providerMeterId === summary.providerMeterId &&
          active(m, input.periodStart),
      )) {
        const key = JSON.stringify([cm.sourceCustomerId, mm.sourceMetricKey]);
        if (!groups.has(key)) groups.set(key, []);
      }
    }
  }
  const results: ReconciliationResult[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const [customerId, metricKey] = JSON.parse(key) as [string, string];
      const findings: ReconciliationFinding[] = [];
      const add = (type: ReconciliationFinding["type"], message: string) => {
        if (!findings.some((f) => f.type === type))
          findings.push({ type, message });
      };
      const prices = new Map<string, FlatUnitPricingRule>();
      const cms = new Map<string, CustomerMapping>();
      const mms = new Map<string, MetricMapping>();
      const parts: { quantity: string; unitPrice: string }[] = [];
      let unsupported = false;
      let incomplete =
        !input.sourceComplete || !input.provider.complete || dedup.conflicting;
      let pricingMissing = false;
      const targets = group.length
        ? group
        : [{ occurredAt: input.periodStart, quantity: "0" }];
      for (const e of targets) {
        const cm = resolveCustomerMapping(
          input.customerMappings,
          customerId,
          e.occurredAt,
        );
        const mm = resolveMetricMapping(
          input.metricMappings,
          metricKey,
          e.occurredAt,
        );
        if (!cm) {
          add("UNMAPPED_CUSTOMER", "No effective customer mapping.");
          incomplete = true;
        } else cms.set(cm.id, cm);
        if (!mm) {
          add("UNMAPPED_METRIC", "No effective metric mapping.");
          incomplete = true;
        } else mms.set(mm.id, mm);
        const p = resolvePricingRule(
          input.pricing,
          metricKey,
          cm?.id,
          e.occurredAt,
        );
        if (!p) {
          add("MISSING_PRICING_RULE", "No applicable pricing rule.");
          pricingMissing = true;
          incomplete = true;
        } else {
          prices.set(p.id, p);
          if (
            p.pricingModel !== "FLAT_PER_UNIT" ||
            currencyDigits[p.currency] === undefined ||
            !/^\d+(\.\d{1,18})?$/.test(p.unitPrice)
          ) {
            unsupported = true;
            add(
              "UNSUPPORTED_BILLING_MODEL",
              "Pricing model, currency, or rate is unsupported.",
            );
          } else parts.push({ quantity: e.quantity, unitPrice: p.unitPrice });
        }
      }
      const currencies = new Set([...prices.values()].map((p) => p.currency));
      if (currencies.size > 1) {
        unsupported = true;
        add(
          "UNSUPPORTED_BILLING_MODEL",
          "Currency changed within this component; split the audit period.",
        );
      }
      const currency = currencies.size === 1 ? [...currencies][0]! : null;
      const customerIds = [
        ...new Set([...cms.values()].map((m) => m.providerCustomerId)),
      ];
      const meterIds = [
        ...new Set([...mms.values()].map((m) => m.providerMeterId)),
      ];
      if (customerIds.length > 1 || meterIds.length > 1) {
        unsupported = true;
        add(
          "UNSUPPORTED_BILLING_MODEL",
          "Provider mapping changed during the period; split the audit period.",
        );
      }
      const match = (r: {
        providerCustomerId: string;
        providerMeterId: string;
      }) =>
        customerIds.includes(r.providerCustomerId) &&
        meterIds.includes(r.providerMeterId);
      const inPeriod = (r: Period) =>
        Date.parse(r.periodStart) === Date.parse(input.periodStart) &&
        Date.parse(r.periodEnd) === Date.parse(input.periodEnd);
      const candidateSummaries = input.provider.summaries.filter(match);
      const summaries = candidateSummaries.filter(inPeriod);
      if (candidateSummaries.some((r) => !inPeriod(r))) {
        add(
          "PERIOD_MISMATCH",
          "Provider summary does not match the selected period.",
        );
        incomplete = true;
      }
      const priceIds = [
        ...new Set([...prices.values()].map((p) => p.providerPriceId)),
      ];
      const candidates = input.provider.lines.filter(
        (l) =>
          customerIds.includes(l.providerCustomerId) &&
          l.providerPriceId !== null &&
          priceIds.includes(l.providerPriceId),
      );
      const lines = candidates.filter(
        (l) => l.componentType === "USAGE" && inPeriod(l),
      );
      if (candidates.some((l) => l.componentType === "UNSUPPORTED")) {
        unsupported = true;
        add(
          "UNSUPPORTED_BILLING_MODEL",
          "Comparable invoice contains unsupported discounts, tiers, or adjustments.",
        );
      }
      if (candidates.some((l) => l.componentType === "USAGE" && !inPeriod(l))) {
        add(
          "PERIOD_MISMATCH",
          "Invoice line period differs from the audit period.",
        );
        incomplete = true;
      }
      if (lines.some((l) => l.currency !== currency)) {
        unsupported = true;
        add(
          "UNSUPPORTED_BILLING_MODEL",
          "Invoice currency differs from pricing currency.",
        );
      }
      if (
        lines.some(
          (l) => !["open", "paid", "uncollectible"].includes(l.invoiceStatus),
        )
      ) {
        incomplete = true;
        add("INCOMPLETE_EVIDENCE", "Invoice is not finalized.");
      }
      const pending =
        Date.parse(input.provider.observedAt) <
        Date.parse(input.periodEnd) + input.processingDelaySeconds * 1000;
      const expectedQuantity =
        input.sourceComplete && !dedup.conflicting
          ? group.reduce((n, e) => n.plus(e.quantity), new Money(0)).toFixed(0)
          : null;
      // Absence is unknown, even in a snapshot declared complete. An explicit zero summary is required.
      const providerQuantity =
        summaries.length === 1
          ? quantitySchema.parse(summaries[0]!.quantity)
          : null;
      if (summaries.length !== 1 || !lines.length) {
        incomplete = true;
        add(
          "INCOMPLETE_EVIDENCE",
          "A unique provider summary and comparable usage invoice lines are required; missing records are not zero.",
        );
      }
      const expectedAmount =
        currency && !unsupported && !pricingMissing && expectedQuantity !== null
          ? calculateExpectedCharge(parts, currency)
          : null;
      const actualAmount =
        currency && !unsupported && lines.length
          ? lines
              .reduce((n, l) => n.plus(l.amountMinorUnits), new Money(0))
              .div(new Money(10).pow(currencyDigits[currency]!))
              .toFixed(currencyDigits[currency])
          : null;
      const varianceAmount = compareInvoiceAmounts(
        expectedAmount,
        actualAmount,
      );
      const usageFinding = compareUsageQuantities(
        expectedQuantity,
        providerQuantity,
      );
      if (usageFinding && !pending) findings.push(usageFinding);
      if (
        varianceAmount !== null &&
        !new Money(varianceAmount).isZero() &&
        !usageFinding &&
        !pending
      )
        add(
          "PRICE_MISMATCH",
          "Expected charge differs from comparable usage invoice charges.",
        );
      if (
        [...dedup.duplicates, ...(input.duplicateEventIds ?? [])].some((id) =>
          group.some((e) => e.eventId === id),
        )
      )
        add(
          "DUPLICATE_SOURCE_EVENT",
          "Repeated source event IDs were excluded from billable usage.",
        );
      if (incomplete || pending)
        add(
          "INCOMPLETE_EVIDENCE",
          pending
            ? "Provider aggregation allowance has not elapsed."
            : "Source or provider evidence is incomplete.",
        );
      const evidenceStatus = assessEvidenceCompleteness(
        unsupported,
        pending,
        incomplete,
      );
      return {
        customerId,
        metricKey,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        expectedQuantity,
        providerQuantity,
        expectedAmount,
        actualAmount,
        varianceAmount,
        currency,
        evidenceStatus,
        findings,
        evidence: {
          eventIds: group.map((e) => e.eventId).sort(),
          pricingRuleIds: [...prices.keys()].sort(),
          customerMappingIds: [...cms.keys()].sort(),
          metricMappingIds: [...mms.keys()].sort(),
          providerLineIds: lines.map((l) => l.id).sort(),
          limitations: input.provider.limitations,
        },
      };
    });
  const coveredPairs = new Set(
    results.flatMap((result) => {
      const customers = input.customerMappings.filter((m) =>
        result.evidence.customerMappingIds.includes(m.id),
      );
      const metrics = input.metricMappings.filter((m) =>
        result.evidence.metricMappingIds.includes(m.id),
      );
      return customers.flatMap((c) =>
        metrics.map((m) =>
          JSON.stringify([c.providerCustomerId, m.providerMeterId]),
        ),
      );
    }),
  );
  const uncovered = new Set<string>();
  for (const summary of input.provider.summaries) {
    const pair = JSON.stringify([
      summary.providerCustomerId,
      summary.providerMeterId,
    ]);
    if (coveredPairs.has(pair) || uncovered.has(pair)) continue;
    uncovered.add(pair);
    const customer = input.customerMappings.find(
      (m) =>
        m.providerCustomerId === summary.providerCustomerId &&
        active(m, input.periodStart),
    );
    const metric = input.metricMappings.find(
      (m) =>
        m.providerMeterId === summary.providerMeterId &&
        active(m, input.periodStart),
    );
    const findings: ReconciliationFinding[] = [
      {
        type: "INCOMPLETE_EVIDENCE",
        message:
          "A provider component has no comparable mapped source component.",
      },
    ];
    if (!customer)
      findings.push({
        type: "UNMAPPED_CUSTOMER",
        message: "Provider customer has no effective source mapping.",
      });
    if (!metric)
      findings.push({
        type: "UNMAPPED_METRIC",
        message: "Provider meter has no effective source mapping.",
      });
    results.push({
      customerId:
        customer?.sourceCustomerId ?? `provider:${summary.providerCustomerId}`,
      metricKey:
        metric?.sourceMetricKey ?? `provider:${summary.providerMeterId}`,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      expectedQuantity: null,
      providerQuantity: null,
      expectedAmount: null,
      actualAmount: null,
      varianceAmount: null,
      currency: null,
      evidenceStatus: "INCOMPLETE",
      findings,
      evidence: {
        eventIds: [],
        pricingRuleIds: [],
        customerMappingIds: customer ? [customer.id] : [],
        metricMappingIds: metric ? [metric.id] : [],
        providerLineIds: [],
        limitations: [
          ...input.provider.limitations,
          "This provider component is outside mapped source coverage.",
        ],
      },
    });
  }
  return results.sort((a, b) =>
    JSON.stringify([a.customerId, a.metricKey]).localeCompare(
      JSON.stringify([b.customerId, b.metricKey]),
    ),
  );
}

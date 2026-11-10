import { describe, it, expect } from "vitest";
import {
  calculateExpectedCharge,
  generateReconciliationResult,
  normalizeUsageEvent,
} from "./index";
import type { ReconciliationInput } from "@usageaudit/shared-types";
const start = "2026-10-01T00:00:00Z",
  end = "2026-11-01T00:00:00Z";
export const fixture = (): ReconciliationInput => ({
  periodStart: start,
  periodEnd: end,
  asOf: "2026-11-06T00:00:00Z",
  processingDelaySeconds: 3600,
  sourceComplete: true,
  events: [
    {
      eventId: "1",
      sourceCustomerId: "acme",
      metricKey: "requests",
      quantity: "100000",
      unit: "request",
      occurredAt: start,
      billable: true,
      schemaVersion: 1,
    },
  ],
  customerMappings: [
    {
      id: "cm",
      sourceCustomerId: "acme",
      providerCustomerId: "cus_1",
      effectiveFrom: start,
      effectiveTo: null,
    },
  ],
  metricMappings: [
    {
      id: "mm",
      sourceMetricKey: "requests",
      providerMeterId: "meter_1",
      aggregationMethod: "SUM",
      effectiveFrom: start,
      effectiveTo: null,
    },
  ],
  pricing: [
    {
      id: "p1",
      providerPriceId: "price_1",
      customerMappingId: null,
      metricKey: "requests",
      pricingModel: "FLAT_PER_UNIT",
      unitPrice: "0.02",
      currency: "USD",
      effectiveFrom: start,
      effectiveTo: null,
      version: 1,
    },
  ],
  provider: {
    id: "s1",
    observedAt: "2026-11-05T00:00:00Z",
    complete: true,
    limitations: [],
    summaries: [
      {
        providerCustomerId: "cus_1",
        providerMeterId: "meter_1",
        quantity: "92000",
        periodStart: start,
        periodEnd: end,
        snapshotId: "s1",
        observedAt: "2026-11-05T00:00:00Z",
      },
    ],
    lines: [
      {
        id: "l1",
        invoiceId: "i1",
        providerCustomerId: "cus_1",
        providerPriceId: "price_1",
        quantity: "92000",
        amountMinorUnits: "184000",
        currency: "USD",
        componentType: "USAGE",
        invoiceStatus: "paid",
        periodStart: start,
        periodEnd: end,
      },
    ],
  },
});
const result = (f = fixture()) => generateReconciliationResult(f)[0]!;
describe("financial correctness", () => {
  it('surfaces unmapped provider-only components without inventing zero source usage',()=>{const f=fixture();f.provider.summaries.push({...f.provider.summaries[0]!,providerCustomerId:'cus_unknown'});const result=generateReconciliationResult(f).find(r=>r.customerId==='provider:cus_unknown');expect(result).toMatchObject({expectedQuantity:null,varianceAmount:null,evidenceStatus:'INCOMPLETE'});expect(result?.findings.map(f=>f.type)).toContain('UNMAPPED_CUSTOMER');});
  it("derives the October 2000 / 1840 / 160 scenario", () => {
    expect(result()).toMatchObject({
      expectedAmount: "2000.00",
      actualAmount: "1840.00",
      varianceAmount: "160",
      evidenceStatus: "COMPLETE",
    });
    expect(result().findings[0]?.type).toBe("MISSING_USAGE");
  });
  it("uses exact decimals and rounds once at component level", () => {
    expect(
      calculateExpectedCharge(
        Array.from({ length: 3 }, () => ({
          quantity: "1",
          unitPrice: "0.005",
        })),
        "USD",
      ),
    ).toBe("0.02");
    expect(
      calculateExpectedCharge(
        [{ quantity: "10000000000000001", unitPrice: "0.01" }],
        "USD",
      ),
    ).toBe("100000000000000.01");
  });
  it.each(["-1", "1.1", "NaN", "Infinity", "1e3", " 1", "01"])(
    "rejects unsupported quantity %s",
    (quantity) => {
      expect(() =>
        normalizeUsageEvent({ ...fixture().events[0], quantity }),
      ).toThrow();
    },
  );
  it("finds exact match", () => {
    const f = fixture();
    f.events[0]!.quantity = "92000";
    expect(result(f).findings).toEqual([]);
  });
  it("deduplicates events", () => {
    const f = fixture();
    f.events.push({ ...f.events[0]! });
    expect(result(f).expectedQuantity).toBe("100000");
    expect(result(f).findings.map((x) => x.type)).toContain(
      "DUPLICATE_SOURCE_EVENT",
    );
  });
  it("does not trust conflicting duplicates", () => {
    const f = fixture();
    f.events.push({ ...f.events[0]!, quantity: "5" });
    expect(result(f).expectedQuantity).toBeNull();
  });
  it("detects excess provider usage", () => {
    const f = fixture();
    f.events[0]!.quantity = "1";
    expect(result(f).findings.map((x) => x.type)).toContain("EXCESS_USAGE");
  });
  it("does not treat missing summaries as zero", () => {
    const f = fixture();
    f.provider.summaries = [];
    expect(result(f).providerQuantity).toBeNull();
    expect(result(f).findings.map((x) => x.type)).not.toContain(
      "MISSING_USAGE",
    );
  });
  it("recognizes explicit provider zero", () => {
    const f = fixture();
    f.provider.summaries[0]!.quantity = "0";
    expect(result(f).findings.map((x) => x.type)).toContain("MISSING_USAGE");
  });
  it("does not treat absent invoice lines as zero", () => {
    const f = fixture();
    f.provider.lines = [];
    expect(result(f).actualAmount).toBeNull();
  });
  it("uses half-open UTC periods", () => {
    const f = fixture();
    f.events.push({ ...f.events[0]!, eventId: "end", occurredAt: end });
    expect(result(f).expectedQuantity).toBe("100000");
  });
  it("includes late arriving events by occurrence time", () => {
    const f = fixture();
    f.events.push({
      ...f.events[0]!,
      eventId: "late",
      quantity: "1",
      occurredAt: "2026-10-31T23:59:59Z",
    });
    expect(result(f).expectedQuantity).toBe("100001");
  });
  it("excludes nonbillable events", () => {
    const f = fixture();
    f.events.push({ ...f.events[0]!, eventId: "free", billable: false });
    expect(result(f).expectedQuantity).toBe("100000");
  });
  it("uses effective price changes", () => {
    const f = fixture();
    f.pricing[0]!.effectiveTo = "2026-10-15T00:00:00Z";
    f.pricing.push({
      ...f.pricing[0]!,
      id: "p2",
      version: 2,
      unitPrice: "0.03",
      effectiveFrom: "2026-10-15T00:00:00Z",
      effectiveTo: null,
    });
    f.events.push({
      ...f.events[0]!,
      eventId: "2",
      quantity: "100",
      occurredAt: "2026-10-15T00:00:00Z",
    });
    expect(result(f).expectedAmount).toBe("2003.00");
  });
  it("gives customer-specific rates precedence", () => {
    const f = fixture();
    f.pricing.push({
      ...f.pricing[0]!,
      id: "custom",
      customerMappingId: "cm",
      unitPrice: "0.01",
    });
    expect(result(f).expectedAmount).toBe("1000.00");
  });
  it.each(["customerMappings", "metricMappings", "pricing"] as const)(
    "reports missing %s",
    (field) => {
      const f = fixture();
      f[field] = [];
      expect(result(f).evidenceStatus).toBe("INCOMPLETE");
    },
  );
  it("rejects overlapping applicable rules", () => {
    const f = fixture();
    f.pricing.push({ ...f.pricing[0]!, id: "overlap" });
    expect(() => result(f)).toThrow("Ambiguous");
  });
  it("reports unsupported tiers", () => {
    const f = fixture();
    f.pricing[0]!.pricingModel = "TIERED";
    expect(result(f)).toMatchObject({
      expectedAmount: null,
      evidenceStatus: "UNSUPPORTED",
    });
  });
  it("excludes taxes and fixed fees", () => {
    const f = fixture();
    for (const componentType of ["TAX", "FIXED", "DISCOUNT"] as const)
      f.provider.lines.push({
        ...f.provider.lines[0]!,
        id: componentType,
        componentType,
        amountMinorUnits: "999999",
      });
    expect(result(f).actualAmount).toBe("1840.00");
  });
  it("rejects mixed currencies", () => {
    const f = fixture();
    f.provider.lines[0]!.currency = "EUR";
    expect(result(f).varianceAmount).toBeNull();
    expect(result(f).evidenceStatus).toBe("UNSUPPORTED");
  });
  it("does not infer complete source evidence", () => {
    const f = fixture();
    f.sourceComplete = false;
    expect(result(f).expectedAmount).toBeNull();
  });
  it("keeps recent summaries pending", () => {
    const f = fixture();
    f.provider.observedAt = end;
    expect(result(f).evidenceStatus).toBe("PENDING_DATA");
    expect(result(f).findings.map((x) => x.type)).not.toContain(
      "MISSING_USAGE",
    );
  });
  it("flags mismatched periods", () => {
    const f = fixture();
    f.provider.summaries[0]!.periodEnd = "2026-10-31T00:00:00Z";
    expect(result(f).findings.map((x) => x.type)).toContain("PERIOD_MISMATCH");
  });
  it("is deterministic on reruns and reordered events", () => {
    const f = fixture();
    f.events.push({ ...f.events[0]!, eventId: "2" });
    const a = generateReconciliationResult(f);
    f.events.reverse();
    expect(generateReconciliationResult(f)).toEqual(a);
  });
});

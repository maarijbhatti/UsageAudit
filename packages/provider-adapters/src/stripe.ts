import Stripe from "stripe";
import Decimal from "decimal.js";
import type {
  ProviderInvoiceLine,
  ProviderSnapshot,
  ProviderUsageSummary,
} from "@usageaudit/shared-types";
import type { BillingProviderAdapter, SyncRequest } from "./provider";
const integer = (n: number) => {
  if (!Number.isSafeInteger(n))
    throw new Error("Provider value exceeds safe integer precision");
  return String(n);
};
const utc = (seconds: number) => new Date(seconds * 1000).toISOString();
export function normalizeStripeLine(
  line: Stripe.InvoiceLineItem,
  price: Stripe.Price | null,
  customer: string,
  invoice: Stripe.Invoice,
): ProviderInvoiceLine {
  const rawQuantity =
    line.quantity_decimal?.toString() ??
    (line.quantity === null ? null : integer(line.quantity));
  const quantity =
    rawQuantity !== null &&
    new Decimal(rawQuantity).isInteger() &&
    new Decimal(rawQuantity).gte(0)
      ? new Decimal(rawQuantity).toFixed(0)
      : null;
  const proration =
    line.parent?.subscription_item_details?.proration ||
    line.parent?.invoice_item_details?.proration;
  const unsupported =
    !price ||
    price.billing_scheme !== "per_unit" ||
    !!price.transform_quantity ||
    !!price.custom_unit_amount ||
    price.tax_behavior === "inclusive" ||
    !!line.discounts?.length ||
    !!line.discount_amounts?.length ||
    !!line.pretax_credit_amounts?.length ||
    !!proration ||
    (rawQuantity !== null && quantity === null) ||
    line.taxes?.some((t) => t.tax_behavior === "inclusive");
  return {
    id: line.id,
    invoiceId: invoice.id,
    providerCustomerId: customer,
    providerPriceId: price?.id ?? null,
    periodStart: utc(line.period.start),
    periodEnd: utc(line.period.end + 1),
    quantity,
    amountMinorUnits: integer(line.subtotal),
    currency: line.currency.toUpperCase(),
    componentType: unsupported
      ? "UNSUPPORTED"
      : price?.recurring?.usage_type === "metered"
        ? "USAGE"
        : "FIXED",
    invoiceStatus: invoice.status ?? "draft",
    raw: JSON.parse(JSON.stringify({ line, price })) as Record<string, unknown>,
  };
}
export class StripeAdapter implements BillingProviderAdapter {
  private stripe: Stripe;
  constructor(
    private key: string,
    client?: Stripe,
  ) {
    if (!/^rk_(test|live)_/.test(key))
      throw new Error("Use a restricted Stripe key");
    this.stripe =
      client ?? new Stripe(key, { maxNetworkRetries: 2, timeout: 30000 });
  }
  async testConnection() {
    await this.stripe.customers.list({ limit: 1 });
    await this.stripe.billing.meters.list({ limit: 1 });
    await this.stripe.invoices.list({ limit: 1 });
    await this.stripe.prices.list({ limit: 1 });
    return {
      ok: true,
      environment: this.key.startsWith("rk_live_")
        ? ("live" as const)
        : ("test" as const),
      accountId: null,
    };
  }
  async listCustomers() {
    const result: { id: string; name: string | null }[] = [];
    for await (const c of this.stripe.customers.list({ limit: 100 })) {
      if (result.length >= 10000)
        throw new Error("Customer synchronization limit exceeded");
      result.push({ id: c.id, name: c.name ?? null });
    }
    return result;
  }
  async fetchSnapshot(r: SyncRequest): Promise<ProviderSnapshot> {
    const start = Date.parse(r.periodStart) / 1000,
      end = Date.parse(r.periodEnd) / 1000;
    if (!Number.isInteger(start / 60) || !Number.isInteger(end / 60))
      throw new Error("Stripe meter periods must align to UTC minutes");
    if (r.customers.length * r.meters.length > 1000)
      throw new Error("Snapshot scope exceeds 1000 customer-meter pairs");
    const summaries: ProviderUsageSummary[] = [],
      lines: ProviderInvoiceLine[] = [];
    const raw: unknown[] = [];
    const priceCache = new Map<string, Stripe.Price>();
    for (const customer of r.customers) {
      for (const meter of r.meters) {
        let quantity = new Decimal(0),
          found = false;
        let pages = 0;
        for await (const s of this.stripe.billing.meters.listEventSummaries(
          meter,
          { customer, start_time: start, end_time: end, limit: 100 },
        )) {
          if (++pages > 10000) throw new Error("Summary limit exceeded");
          quantity = quantity.plus(integer(s.aggregated_value));
          found = true;
          raw.push(s);
        }
        if (found)
          summaries.push({
            providerCustomerId: customer,
            providerMeterId: meter,
            periodStart: r.periodStart,
            periodEnd: r.periodEnd,
            quantity: quantity.toFixed(0),
            snapshotId: r.snapshotId,
            observedAt: r.observedAt,
          });
      }
      let invoiceCount = 0;
      for await (const invoice of this.stripe.invoices.list({
        customer,
        limit: 100,
      })) {
        if (++invoiceCount > 10000)
          throw new Error("Invoice limit exceeded; narrow account scope");
        let lineCount = 0;
        for await (const line of this.stripe.invoices.listLineItems(
          invoice.id,
          { limit: 100 },
        )) {
          if (++lineCount > 10000)
            throw new Error("Invoice line limit exceeded");
          if (line.period.end < start || line.period.start >= end) continue;
          const ref = line.pricing?.price_details?.price;
          const priceId = typeof ref === "string" ? ref : ref?.id;
          let price: Stripe.Price | null = null;
          if (priceId) {
            price =
              priceCache.get(priceId) ??
              (await this.stripe.prices.retrieve(priceId));
            priceCache.set(priceId, price);
          }
          lines.push(normalizeStripeLine(line, price, customer, invoice));
        }
        raw.push({
          id: invoice.id,
          status: invoice.status,
          currency: invoice.currency,
          total: invoice.total,
        });
      }
    }
    return {
      id: r.snapshotId,
      observedAt: r.observedAt,
      complete: true,
      summaries,
      lines,
      raw,
      limitations: [
        "Stripe summaries are asynchronously aggregated; event-level delivery evidence is unavailable.",
        "Invoice line period.end is normalized from Stripe’s documented inclusive second to an exclusive boundary. Period mismatches require investigation.",
        "Only explicitly mapped customers and meters were queried.",
      ],
    };
  }
}

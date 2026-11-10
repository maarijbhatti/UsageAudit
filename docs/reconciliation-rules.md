# Reconciliation rules, algorithm 1.0.0

1. Validate source events: decimal-string nonnegative integers, explicit units, UTC timestamp, billable boolean, schema version 1.
2. Deduplicate by source event ID within an organization. A conflicting payload makes evidence incomplete; accepted logical events are never overwritten.
3. Include billable events with `periodStart <= occurredAt < periodEnd`. Late-arriving events are eligible according to occurrence time in the selected immutable import.
4. Resolve effective customer and SUM metric mappings at each event time. Mapping identity changes across an audit component require splitting the period.
5. Resolve customer-specific pricing before the organization default. Ambiguous overlap is rejected. Reconstruct amounts using Decimal, sum unrounded products, then round once for each customer/metric/currency component, HALF_UP to the configured currency exponent.
6. Compare only provider summaries for the exact explicit period. Missing summaries are unknown (`null`), never zero; an explicit zero record is meaningful.
7. Sum only comparable USAGE invoice lines with matching customer, price IDs, currency, and period. Fixed fees, tax and discount component rows are excluded from the comparison. A usage charge affected by complex adjustments must be marked UNSUPPORTED, not relabeled as ordinary usage.
8. `variance = expected charge - actual comparable charge`. Positive is potential underbilling; negative is potential overbilling. Currency totals are never combined.
9. Evidence is COMPLETE, PENDING_DATA, INCOMPLETE, or UNSUPPORTED. Snapshot timestamps before period end plus the configured aggregation allowance produce PENDING_DATA. Rejected source rows prevent an authoritative expected charge. Draft or void invoice evidence is not complete.
10. Review status is independent: OPEN, INVESTIGATING, CONFIRMED, DISMISSED, RESOLVED. Confirmation requires complete evidence and an explicit authorized review.

Supported currencies: USD/EUR/GBP/CAD/AUD (2 decimals), JPY (0), KWD/BHD (3). Unknown currencies and non-flat pricing are unsupported. No taxes, credits, prepaid balances, minimum commitments, transformed quantities, or tier pricing are reconstructed.

Stripe meter summaries use exclusive end times aligned to minutes. The SDK documents invoice line end times as inclusive seconds; the adapter converts these to exclusive seconds and preserves raw timestamps. Any resulting mismatch with the selected meter period is surfaced, not silently forced to match. Validate account-specific invoice period conventions before live operational use.

CSV imports require an explicit invoice line `componentType` and `invoiceStatus`. Their completeness is user-supplied evidence, not independent confirmation of export coverage. Event-level Stripe delivery evidence is unavailable in this integration. Live credentials never fall back to fixtures on failure.

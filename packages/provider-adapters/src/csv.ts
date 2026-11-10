import { z } from "zod";
const id = z.string().min(1).max(200),
  time = z.iso.datetime(),
  quantity = z.string().regex(/^(0|[1-9]\d{0,29})$/);
const period = { periodStart: time, periodEnd: time };
export const summarySchema = z
  .object({ providerCustomerId: id, providerMeterId: id, ...period, quantity })
  .refine((r) => Date.parse(r.periodStart) < Date.parse(r.periodEnd), {
    message: "Period end must be after start",
  });
export const lineSchema = z
  .object({
    id,
    invoiceId: id,
    providerCustomerId: id,
    providerPriceId: id.nullable(),
    ...period,
    quantity: quantity.nullable(),
    amountMinorUnits: z.string().regex(/^-?(0|[1-9]\d{0,29})$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    componentType: z.enum(["USAGE", "FIXED", "TAX", "DISCOUNT", "UNSUPPORTED"]),
    invoiceStatus: z.enum(["draft", "open", "paid", "uncollectible", "void"]),
  })
  .refine((r) => Date.parse(r.periodStart) < Date.parse(r.periodEnd), {
    message: "Period end must be after start",
  });
export const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function csvRow(values: unknown[]) {
  return values.map(csvCell).join(",") + "\r\n";
}

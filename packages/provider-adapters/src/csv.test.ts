import { it, expect } from "vitest";
import { csvCell, lineSchema, summarySchema } from "./csv";
import {validateCsvHeaders} from './headers';
it('rejects ambiguous or unsafe CSV headers',()=>{for(const headers of [['eventId','eventId'],[''],['__proto__']])expect(()=>validateCsvHeaders(headers)).toThrow();expect(validateCsvHeaders(['eventId','quantity'])).toEqual(['eventId','quantity']);});
it("neutralizes spreadsheet formulas including leading whitespace", () => {
  for (const value of ["=SUM(A1)", "+cmd", "-cmd", "@sum", "  =1", "\t=1"])
    expect(csvCell(value)).toBe("\"'" + value + '"');
  expect(csvCell('a,"b"')).toBe('"a,""b"""');
});
it("rejects fractional provider quantities and backwards periods", () => {
  expect(
    summarySchema.safeParse({
      providerCustomerId: "c",
      providerMeterId: "m",
      quantity: "1.1",
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2026-11-01T00:00:00Z",
    }).success,
  ).toBe(false);
  expect(lineSchema.safeParse({}).success).toBe(false);
});

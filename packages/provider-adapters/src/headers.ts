export function validateCsvHeaders(headers: string[]): string[] {
  if (
    !headers.length ||
    headers.length > 50 ||
    headers.some(
      (h) =>
        !h ||
        h.length > 200 ||
        ["__proto__", "constructor", "prototype"].includes(h),
    ) ||
    new Set(headers).size !== headers.length
  )
    throw new Error(
      "CSV headers must be unique, nonempty, safe names; maximum 50 columns",
    );
  return headers;
}

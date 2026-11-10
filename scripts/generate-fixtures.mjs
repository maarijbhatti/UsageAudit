import { createWriteStream, mkdirSync } from "node:fs";
import { once } from "node:events";
mkdirSync("fixtures/generated", { recursive: true });
const out = createWriteStream("fixtures/generated/usage-100000.csv");
out.write(
  "eventId,sourceCustomerId,metricKey,quantity,unit,occurredAt,billable\n",
);
for (let i = 0; i < 100000; i++) {
  if (
    !out.write(
      `request_${i},acme,requests,1,request,2026-10-15T00:00:00Z,true\n`,
    )
  )
    await once(out, "drain");
}
out.end();
await once(out, "finish");
console.log("Generated 100,000 distinct application events.");

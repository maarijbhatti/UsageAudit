# API

Swagger is generated at `/api/docs`; endpoints use `/api/v1`. JSON validation rejects unknown DTO fields. Errors use `{ "error": { "status": 400, "detail": ... } }`. Asynchronous requests return `{id,status}` with HTTP 202. Paginated collections use `{items,total,page,pageSize}` where a full count is available; row-error/run-finding previews may omit `total`.

Cookie-authenticated mutations require the configured `Origin` and `x-csrf-token` matching the readable `ua_csrf` cookie. Tenant routes additionally require `x-organization-id`, independently checked against database membership. The web proxy forwards these without exposing service credentials.

| Area          | Endpoints                                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | POST `auth/register`, `auth/login`, `auth/refresh`, `auth/logout`; GET `auth/me`                                                                                                                                 |
| Organizations | GET/POST `organizations`; GET/DELETE `organizations/:id`; POST `organizations/:id/settings`; GET `organizations/:id/members`; POST `organizations/:id/invitations`; DELETE `organizations/:id/members/:memberId` |
| Imports       | POST/GET `imports`; GET `imports/:id`, `imports/:id/preview`, `imports/:id/errors`; POST `imports/:id/confirm`                                                                                                   |
| Configuration | GET `customers`; GET/POST `customer-mappings`, `metric-mappings`, `pricing-rules`; GET `pricing-rules/:id`                                                                                                       |
| Snapshots     | GET/POST `provider-snapshots`                                                                                                                                                                                    |
| Audits        | POST `reconciliation-runs/readiness`; GET/POST `reconciliation-runs`; GET `reconciliation-runs/:id`, `reconciliation-runs/:id/findings`                                                                          |
| Findings      | GET `findings`, `findings/:id`; POST `findings/:id/reviews`                                                                                                                                                      |
| Dashboard     | GET `dashboard/overview`, `dashboard/exception-summary`, `dashboard/reconciliation-history`                                                                                                                      |
| Reports       | GET/POST `reports`; GET `reports/:id`, `reports/:id/download`                                                                                                                                                    |
| Connections   | GET `connections`; POST `connections/stripe`, `connections/:id/test`, `connections/:id/sync`, `connections/:id/rotate`; DELETE `connections/:id`                                                                 |
| Operations    | GET `jobs`, `audit-logs`, `schedules`; POST `jobs/retry`, `schedules`, `schedules/:id`                                                                                                                           |

Multipart upload: `file` (one CSV, maximum 32 MiB), `importType` (`APPLICATION_USAGE`, `BILLING_USAGE`, `INVOICE_LINES`). Upload returns `UPLOADED`. Preview reads five rows. Confirmation body is `{"columnMapping":{"eventId":"your_event_column"}}`; empty mapping uses canonical CSV headers. Worker parsing enforces 200,000 rows and 64 KiB per record.

Create a CSV provider snapshot with `{"usageImportId":"uuid","invoiceImportId":"uuid"}` after both imports complete. Audit request:

```json
{
  "periodStart": "2026-10-01T00:00:00Z",
  "periodEnd": "2026-11-01T00:00:00Z",
  "sourceImportBatchId": "uuid",
  "providerSnapshotId": "uuid",
  "requestKey": "unique-client-request-id"
}
```

Reusing a requestKey in the same organization returns its existing run. Use a new key for a new snapshot/rerun. Review body: `{"newStatus":"INVESTIGATING","comment":"Checking delivery records"}`. Report body: `{"reconciliationRunId":"uuid"}`.

Schedules use the audit selection fields plus `nextRunAt`; they run once per day in UTC against the same explicit period and snapshots. Job retry takes `{"jobId":"outbox-uuid"}` and only accepts FAILED jobs. Collection caps are 100 for snapshots, reports and jobs, 1,000 observed customer identifiers. These MVP caps are documented rather than presented as unlimited lists.

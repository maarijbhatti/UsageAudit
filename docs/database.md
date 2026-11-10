# Database and integrity

`apps/api/src/database/migrations/1793923200000-InitialSchema.ts` creates the schema transactionally. No environment uses TypeORM schema synchronization. `pnpm db:migrate` applies migrations; `pnpm db:revert` reverses the latest migration and is destructive to its tables. Use rollback only in disposable development databases or with a reviewed backup/restore plan. Production changes should normally use forward migrations.

Tables cover identity/sessions, organizations/membership, connections, imports/raw rows/events/batch references, customer/metric mappings, pricing, provider snapshots/summaries/invoices/lines, audit runs/findings/reviews, reports, audit logs, schedules, and the job outbox.

- UUID identifiers and TIMESTAMPTZ timestamps.
- NUMERIC for quantities and monetary values; API values are decimal strings.
- Composite `(organization_id, id)` keys and foreign keys prevent tenant-crossing nested references.
- PostgreSQL `btree_gist` exclusion constraints reject overlapping mappings and prices. Reverse customer and meter mappings are also unique for an effective period, preventing ambiguous aggregation.
- Customer-specific prices override organization defaults. Pricing versions increment under a transaction advisory lock.
- Usage, raw rows, provider snapshots, reviews, and audit logs have immutable-change triggers.
- Reconciliation runs preserve their full JSON input, including price/mapping versions and algorithm version, independent of later configuration changes.
- Source event IDs identify a single logical event across all metrics within an organization. A producer must supply globally unique event IDs within that organization. Identical repeats are duplicates; changed content is rejected as a conflicting duplicate.

JSONB holds raw evidence and reusable contracts; indexed relational columns drive tenant scoping and operational queries. The API does not expose unrestricted SQL or client-controlled table/column identifiers.

Development uses the Compose owner role to create the initial extension and schema. Production should provision `btree_gist` via an administrative migration account, run migrations separately, and use restricted API/worker roles. See `infrastructure/postgres-runtime-role.sql` for a grants template. Database superusers can bypass application protection; secure administrative access and backups accordingly.

-- Run as a migration administrator; supply role credentials outside this file.
-- Example: CREATE ROLE usageaudit_runtime LOGIN; then configure its password via your secret manager.
GRANT CONNECT ON DATABASE usageaudit TO usageaudit_runtime;
GRANT USAGE ON SCHEMA public TO usageaudit_runtime;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO usageaudit_runtime;
GRANT UPDATE ON users, organizations, auth_sessions, connections, import_batches,
  reconciliation_runs, reconciliation_findings, reports, reconciliation_schedules, job_outbox
  TO usageaudit_runtime;
GRANT DELETE ON organization_members TO usageaudit_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO usageaudit_runtime;
REVOKE ALL ON migrations FROM usageaudit_runtime;
-- No UPDATE/DELETE on immutable evidence, mappings, or pricing rules.
-- Apply equivalent reviewed grants to newly added tables with future migrations.

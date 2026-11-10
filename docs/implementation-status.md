# Implementation status

Last verification: November 10, 2026. The MVP is implemented and its required automated quality gates **passed in GitHub Actions** on code commit `8818db5`. [Verified CI run](https://github.com/maarijbhatti/UsageAudit/actions/runs/42797683547). Local Windows Docker remains blocked by WSL startup; CI provided independent PostgreSQL, Redis, MinIO and Chromium verification. No live Stripe credentials were supplied.

## Milestones and important files

| Milestone              | Completed capabilities and files                                                                                                                                            | Verification and remaining work                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0: inspection          | Empty GitHub repository, no AGENTS.md. Node 24.14.1; pinned compatible pnpm, NestJS, Next.js and TypeScript versions.                                                       | Registry engine/peer metadata checked before installation. TypeScript 6 satisfies Swagger and ESLint peers.                                                                              |
| 1: foundation          | Workspace/Turbo/TypeScript configuration, `apps/web`, `apps/api`, `apps/worker`, shared packages, `infrastructure/compose.yaml`.                                            | Install, lint, types and production build passed. Compose previously built and started.                                                                                                  |
| 2: database/auth       | `apps/api/src/database`, `modules/auth`, `modules/organizations`, `common/security.ts`; authentication/onboarding UI.                                                       | Empty-database migration, authentication/tenant isolation and rollback/reapply all passed in CI.                                                                                         |
| 3: ingestion           | `modules/imports`, private S3 storage, streamed parser, immutable raw rows, event deduplication, preview/mapping UI.                                                        | Real integration scenario imported 100,000 distinct rows twice without doubling usage. Header validation unit tests pass.                                                                |
| 4: mapping/pricing     | `modules/pricing`, versioned effective dates, customer/metric/pricing UI.                                                                                                   | Unit tests cover effective dates. Earlier integration run verified later prices do not change frozen results.                                                                            |
| 5: calculation         | `packages/billing-core`: Decimal arithmetic, UTC half-open periods, flat pricing, evidence classification, missing-versus-zero distinctions, uncovered provider components. | Financial unit tests pass within the 40-test suite. Unsupported inputs remain explicit.                                                                                                  |
| 6: persisted audits    | `modules/reconciliation`, `apps/worker/src/runner.ts`, transaction outbox, bounded retries, frozen inputs, results/findings.                                                | CI derived 2,000.00 expected / 1,840.00 actual / 160 potential underbilling; bounded failure and retry assertions passed.                                                                |
| 7: Stripe              | `packages/provider-adapters/src/stripe.ts`, `modules/connections`, encrypted credentials, read-only sync, pagination, fixture adapter.                                      | Official SDK transport tests assert GET-only requests and pagination. Encryption/tamper/tenant-binding tests pass. Live verification remains outstanding.                                |
| 8: dashboard/review    | `apps/web/src/features`, real aggregates, findings filters/details, evidence, append-only review history.                                                                   | Full real-API browser flow passed in CI, including audit/review/export, tenant denial and mobile width. Separate local layout regression also passed.                                    |
| 9: reports/operations  | `modules/reports`, `modules/operations`, private CSV downloads, formula escaping, daily pinned-evidence schedules, retries, organization/member controls, CI.               | CSV, report generation/download and expanded authorization checks passed in CI. New settings controls compiled successfully; no separate browser scenarios cover rename/removal/closure. |
| 10: validation/handoff | README, architecture/API/database/security/financial-rule/local-development docs, integration/E2E/layout tests.                                                             | All required CI gates passed. The example application Docker image itself remains unverified; the infrastructure images were exercised by CI.                                            |

## Commands and observed results

Commands ran from the repository root. This Windows workspace uses the ignored `.tools/pnpm.cmd` wrapper on PATH; a global pnpm installation uses the same commands.

| Command                          | Result                                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Passed November 10; lockfile accepted without changes.                                                                                                                                                                                 |
| `pnpm lint`                      | Passed.                                                                                                                                                                                                                                |
| `pnpm typecheck`                 | Passed.                                                                                                                                                                                                                                |
| `pnpm test`                      | Passed November 10: 5 files, 40 tests covering core, CSV, Stripe transport, encryption and form validation.                                                                                                                            |
| `pnpm build`                     | Passed November 10: shared packages, API/worker and Next.js production build. Frontend rebuilt after final layout fixes.                                                                                                               |
| `pnpm audit --prod`              | November 10: no known vulnerabilities found.                                                                                                                                                                                           |
| `pnpm db:migrate`                | Passed locally earlier and against empty PostgreSQL in CI.                                                                                                                                                                             |
| `pnpm db:seed`                   | Passed locally earlier and in CI: two organizations, three users, fixture imports, calculated findings and generated report.                                                                                                           |
| `pnpm test:integration`          | Passed in CI: both current tests, including 100,000 rows imported twice, frozen results, tenant/RBAC checks, reviews/reports, bounded retries and migration rollback/reapply. Local rerun was blocked by `ECONNREFUSED` on port 5438.  |
| `pnpm test:e2e`                  | Passed in CI: registration, organization creation, usage reimport, mappings/pricing, billing snapshot, computed audit, review, export, foreign-tenant denial and responsive navigation. Local API startup remains blocked by Docker.   |
| `pnpm test:layout`               | Passed November 10: 1 Chromium regression, including navigation, desktop rendering, mobile width and internally scrollable tables. Screenshots inspected. Uses intercepted test responses; does not replace real API E2E verification. |

## Local environment blocker

Docker Desktop reports `no connected VM` / HTTP 500; Windows `WslService` is stuck in `StartPending`. The user authorized restarting WSL. The normal service restart lacked administrator rights, `wsl --shutdown` did not complete, and Windows canceled the administrator prompt for recovery. No volumes were removed, no database was reset, and no machine reboot was attempted.

After restoring WSL/Docker, run:

```bash
docker compose --env-file .env -f infrastructure/compose.yaml up -d --build --wait
pnpm db:migrate
pnpm test:integration
pnpm test:e2e
```

CI passed viewer write denial, nested tenant isolation, immutable-row protection and three-attempt worker failure/retry checks. The rollback/reapply test used a dedicated database ending in `_test`. Local execution still requires Docker recovery.

## Decisions and limits

- TypeORM manages migrations, transactions and identity EntitySchemas. Bulk domain queries use parameterized SQL and composite tenant constraints. Domain controllers share a DomainModule rather than a repository/entity layer per table.
- Amounts and quantities remain decimal strings; supported currencies have explicit rounding. Missing provider evidence remains unknown. Only complete supported evidence can support confirmed financial findings.
- Runs capture inputs and configuration. Later prices/mappings do not rewrite historical results. Large input capture still happens in an API transaction, a future scaling boundary.
- Schedules rerun a fixed period with pinned evidence daily in UTC. They do not discover new periods or synchronize fresh provider data.
- Stripe needs a restricted account key with required read permissions. All adapter calls are reads, but Stripe has no complete key-permission attestation API. Live sync is unverified.
- Members must register before being added. Removal, workspace renaming and owner-only soft closure are implemented. Email invitations, password recovery, MFA and SSO are outside this MVP.
- Existing price versions are immutable; non-overlapping periods must be planned. Tiers, discounts, prorations, transformed quantities, inclusive tax and unsupported currencies are flagged.
- CSV exports contain findings; matched runs produce header-only reports. Detail previews cap source records at 100 while retaining full frozen input.
- PostgreSQL RLS is not enabled: tenant enforcement uses scoped queries and composite constraints. Deployment needs managed secrets, TLS, least-privilege roles, backups, retention policies, monitoring and security review.
- The CI workflow and infrastructure source image are verified. The optional app Dockerfile remains unverified. No hosting deployment was performed.

## Remaining operational steps

Restore local WSL/Docker to run the application on this Windows machine. Verify live read-only Stripe when credentials are available. Before production, complete the deployment/security work described above and validate the optional application container image. CI success is evidence for the implemented MVP workflows, not production certification.

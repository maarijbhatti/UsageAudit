# Local development

Use the sequence in README. `pnpm setup` is idempotent and preserves `.env`. Compose requires `--env-file .env` because its file lives under `infrastructure/`. On Windows use Docker Desktop Linux containers and PowerShell. If pnpm is installed only in `.tools`, put the `.tools` directory containing the local pnpm wrapper on PATH; a standard global/Corepack installation needs no wrapper.

Commands:

| Command                 | Purpose                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`              | Build shared/server sources and start API, worker, Next development server |
| `pnpm build`            | Shared packages, backend/worker, optimized Next production build           |
| `pnpm db:migrate`       | Build server and apply TypeORM migrations                                  |
| `pnpm db:revert`        | Revert latest migration (destructive; disposable databases only)           |
| `pnpm db:seed`          | Seed fresh local demo using compiled services                              |
| `pnpm fixtures:large`   | Stream-generate 100,000 distinct source events                             |
| `pnpm test:integration` | Real PostgreSQL, S3 and BullMQ workflow; separate test databases           |
| `pnpm test:e2e`         | Chromium UI workflow on ports 3100/4100; build first                       |

The initial MinIO build takes several minutes. A failed pull of the old `minio/minio` image is not a credential problem: this repository supplies a source build instead. Keep local MinIO behind loopback and use a maintained service for deployment.

Next.js/Vitest/Playwright spawn subprocesses. Restricted Windows execution sandboxes may return `spawn EPERM`; run the same command in an approved normal terminal. Integration tests use Node's `--test-isolation=none` so they do not require a test child process. Test failures are never suppressed or treated as passes.

Demo data is fictional. `valid-usage.csv` includes an Acme event representing 100,000 units and additional edge cases. `fixtures:large` produces 100,000 individual one-unit events for scale testing. The API integration test independently generates and imports 100,000 rows twice. Quantities are source values, not hardcoded dashboard totals.

## Deployment

For local application containers, add `-f infrastructure/compose.app.yaml` to the base Compose command as shown in README. The one-shot migration service must succeed before the API starts; the worker and web wait for API health. The web health check exercises the API proxy too. This override deliberately uses development API cookies for local HTTP, with a production-built Next.js server. Production deployments need their own HTTPS configuration.

An example application image is provided in `infrastructure/docker/App.Dockerfile`. Run web, API and worker as separate processes from the same build. Start API with `node dist/apps/api/src/main.js`; worker with `node dist/apps/worker/src/main.js`; web with `node apps/web/node_modules/next/dist/bin/next start apps/web`. Use `NODE_ENV=production`, HTTPS `WEB_ORIGIN`, private `API_ORIGIN`, `HOST=0.0.0.0` for API container networking, managed PostgreSQL/Redis/S3 credentials, and a separately managed encryption key. Never run the demo seed in production.

Run migrations as a separate deployment step under a migration role. Provision runtime roles using the grants template. TLS termination, reverse proxy body limits/timeouts (at least the configured 32 MiB upload limit), durable Redis AOF, PostgreSQL/object-store backups, and secret rotation are deployment concerns. The local Compose file is intentionally not a production orchestrator.

## Verification artifacts

`pnpm test:layout` runs a presentation-only Chromium regression on port 3200 after `pnpm build`. It intercepts responses only within the test and writes `.local/layout-desktop.png` and `.local/layout-mobile.png`; production services never fall back to fixtures.

Playwright failure traces/screenshots go to ignored `test-results/`. Successful desktop/mobile screenshots are written to ignored `.local/dashboard-desktop.png` and `.local/dashboard-mobile.png`. Dependency audit JSON is stored locally under `.local/dependency-audit.json` during validation. No credentials belong in Git or screenshots.

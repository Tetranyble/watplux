# Phase 17 — Deployment & Operations Implementation

Status: SOURCE IMPLEMENTED — PROVIDER CREDENTIALS / LIVE RELEASE PENDING

## 1. Deployment decisions

Watplux production is deployed as an immutable Node.js container built from the repository `Dockerfile`. The runtime is a Next.js standalone image running as an unprivileged user. MySQL is **not** colocated with the application container in production; use a managed MySQL 8-compatible service with TLS, automated backups and point-in-time recovery.

Media uses the Phase 14 S3-compatible provider. Local media storage remains a development-only option. The application continues to expose stable `/api/media/<uuid>` URLs so storage/CDN changes do not rewrite catalog records.

The exact cloud vendor is intentionally not encoded into domain/application code. Hosting region, billing and existing infrastructure are external deployment constraints; the architecture depends only on managed MySQL and S3-compatible object storage.

## 2. Container targets

`Dockerfile` exposes two production targets:

- `runner`: minimal Next.js standalone web runtime. It has no Prisma migration CLI and runs as uid/gid 1001.
- `migrator`: one-shot image containing Prisma CLI and migration files. Run this exactly once before rolling out a new `runner` image.

The runner uses `STOPSIGNAL SIGTERM`, has a process-only Docker health check, and is compatible with a read-only root filesystem when `/tmp` and `/app/.next/cache` are writable tmpfs/ephemeral volumes.

### Build-time database rule

Next.js Cache Components may execute cached server reads during `next build`. Container builds therefore use a **disposable migrated build database with zero production/customer data**. Never point `BUILD_DATABASE_URL` at the production database. The release workflow provisions MySQL, applies migrations, and supplies that disposable database to the builder.

## 3. Release sequence

A production release is ordered:

1. Phase 16 release verification passes.
2. Build immutable runtime and migrator images from the same commit.
3. Confirm managed database automated backup/PITR is healthy; take an on-demand snapshot before a risky migration.
4. Run `node scripts/production-preflight.mjs` against the deployment secrets/configuration.
5. Run the `${revision}-migrator` image once with production `DATABASE_URL`.
6. If migrations succeed, deploy the `${revision}` runtime image.
7. Wait for `/api/live` and `/api/ready` to pass.
8. Verify the internal webhook worker health endpoint and payment smoke path.
9. Observe error logs/webhook backlog during the release window.
10. Mark the release successful; retain the previous immutable runtime image for immediate application rollback.

Migrations are never run automatically from web-container startup. This prevents multiple replicas racing to modify the schema.

## 4. Liveness vs readiness

- `GET /api/live`: process liveness only. It deliberately performs no MySQL/S3/Paystack call. Container/orchestrator liveness probes use this endpoint.
- `GET /api/ready`: traffic readiness. It checks MySQL connectivity plus strict production configuration. A 503 removes the replica from traffic but should not itself cause a restart.
- `GET /api/health`: retained compatibility endpoint from earlier phases; it is database-aware and should not be used as a liveness probe.

When `DEPLOYMENT_ENV=production`, readiness also requires HTTPS application/auth origins, Paystack configuration, the internal worker secret, guest order token secret, and S3 media configuration.

## 5. Environment identity

`NODE_ENV` describes JavaScript runtime optimization. `DEPLOYMENT_ENV` describes where the instance is deployed:

- local
- test
- build
- staging
- production

This lets staging run optimized `NODE_ENV=production` code without passing the live-production readiness policy.

`APP_VERSION` and `GIT_SHA` are emitted by liveness and structured logs and should be set to the immutable release identity.

## 6. Managed MySQL policy

Production requirements:

- MySQL 8-compatible managed service.
- Private networking/security-group access where the platform supports it.
- TLS required in transit.
- Encryption at rest enabled by the provider.
- Automated daily backups plus point-in-time recovery.
- A retention period agreed before launch (baseline: 7+ days; increase for business/compliance needs).
- Connection limits monitored; Prisma instance count must be considered when horizontally scaling web replicas.
- Schema migrations run only through the release migrator image.

Do not deploy MySQL from `docker-compose.yml` in production; that compose file remains local-development infrastructure only.

## 7. Media/object-storage policy

Production requires `MEDIA_STORAGE_PROVIDER=s3` and an S3-compatible bucket. Preferred operations:

- private bucket/origin when possible; serve through application/CDN boundary;
- bucket versioning enabled;
- lifecycle rules for superseded/non-current objects after an agreed retention window;
- object-storage access credentials supplied through workload identity/IAM where available, otherwise secret manager;
- CDN cache in front of object storage if the selected platform provides it;
- no storage credentials baked into images.

## 8. Webhook worker deployment

The worker remains the durable MySQL-backed Phase 8/15 model. Production scheduler invokes:

`POST /api/internal/process-webhook-events`

with `x-internal-worker-secret` every minute. `deploy/compose.production.yml` contains a reference scheduler; managed platforms should use their native scheduler/cron and private service URL instead.

The scheduler does not need a customer/admin session. The worker health endpoint should be monitored for pending/stale/failed backlog and alert when degraded.

## 9. Logs and error reporting

Production Pino output remains JSON. Every record now includes:

- `service=watplux-web`
- deployment environment
- application version
- git revision
- process id

Secrets/tokens/passwords remain redacted. The deployment platform must ship stdout/stderr to its log collector. Alerts should be configured at minimum for:

- repeated application `error`/`fatal` logs;
- `/api/ready` sustained failure;
- webhook-worker degraded state or old pending events;
- high 5xx rate;
- managed-MySQL CPU/storage/connection saturation;
- backup/PITR failure.

A vendor-specific exception SDK is intentionally not hardwired before the hosting/observability provider is chosen; structured error logs are the portable release baseline. A Sentry-equivalent provider can be added behind the observability boundary without changing domain code.

## 10. Backups

Managed database backups/PITR are authoritative. `npm run ops:backup:mysql` is an operator convenience for an encrypted/off-host pre-release logical dump when `mysqldump` is available; it writes a gzip-compressed file mode 0600 and does not place the database password on the process command line.

Backups are not considered valid until restoration is tested. Before launch, perform a restore drill into a non-production MySQL instance and run release smoke checks against the restored data.

Object storage should use versioning rather than attempting to put image binaries into database backups.

## 11. Rollback policy

Application rollback is image rollback:

1. stop the rollout;
2. route traffic to the previous known-good immutable runtime image;
3. verify `/api/live` and `/api/ready`;
4. verify worker/payment health.

Database rollback is **not** `prisma migrate reset`, automatic down migrations, or deleting migration rows. Production schema changes must follow expand/contract compatibility so the prior app image remains usable during the release window. If a migration itself corrupts data, stop writes and restore from the managed snapshot/PITR according to the incident runbook.

Media objects are not deleted or rolled back automatically during an application rollback.

## 12. Reference deployment files

- `Dockerfile`
- `.dockerignore`
- `deploy/compose.production.yml`
- `deploy/nginx/watplux.conf`
- `deploy/.env.worker.example`
- `deploy/.env.production.example`
- `deploy/cron/webhook-worker.cron`
- `scripts/production-preflight.mjs`
- `scripts/trigger-webhook-worker.sh`
- `scripts/backup-mysql.mjs`
- `.github/workflows/release.yml`
- `docs/operations/RELEASE_RUNBOOK.md`
- `docs/operations/BACKUP_RESTORE_RUNBOOK.md`
- `docs/operations/INCIDENT_ROLLBACK_RUNBOOK.md`

## 13. Remaining live verification

This source snapshot still cannot install dependencies in the execution sandbox. Before a real release:

```bash
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run test:release
npm run build

docker build --network=host \
  --target runner \
  --build-arg BUILD_DATABASE_URL="$DISPOSABLE_BUILD_DATABASE_URL" \
  --build-arg APP_VERSION="$VERSION" \
  --build-arg GIT_SHA="$GIT_SHA" \
  -t watplux:$GIT_SHA .
```

Then execute the release runbook against staging before production.

# Watplux Release Runbook

## Before deployment

1. Confirm Phase 16 `npm run test:release` and production build passed for the exact commit.
2. Use immutable image tags/digests; record runtime and migrator digests.
3. Confirm managed MySQL is healthy and backup/PITR is current.
4. For any migration that changes or drops existing data structures, take an on-demand managed snapshot before migration.
5. Run `npm run ops:preflight` with production configuration loaded.
6. Confirm Paystack keys are for the intended environment and callback/webhook URLs match the public HTTPS origin.
7. Confirm S3 bucket/versioning and CDN/origin configuration.

## Deploy

1. Run the matching migrator image once:
   `docker run --rm --env-file .env.production IMAGE:REVISION-migrator`
2. Abort if migration returns non-zero. Do not start the new web image.
3. Deploy `IMAGE:REVISION` using rolling replacement with at least one old healthy replica remaining until the new replica is ready.
4. Probe `/api/live` (process) and `/api/ready` (traffic readiness).
5. Trigger the webhook worker once and read its authenticated health endpoint.
6. Smoke: homepage, product listing, login, cart, checkout-to-Paystack redirect using approved test/live release procedure, admin login.
7. Observe structured logs and database metrics for the release window.

## Release acceptance

Record commit SHA, image digest, migration names applied, operator, timestamp and smoke-test result. Keep the previous runtime image immediately available.

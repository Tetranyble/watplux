<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Phase 17 deployment invariants

- Production web runs from the `runner` target in `Dockerfile`; Prisma migrations run once from the separate `migrator` target before rollout. Never add `prisma migrate deploy` to application startup.
- `/api/live` is dependency-free process liveness. `/api/ready` is traffic readiness and may check MySQL/configuration. Do not merge these probes.
- Production MySQL is managed/external; the repository root `docker-compose.yml` database is local development only.
- Production media uses the S3-compatible provider. Do not persist uploaded media on the web container filesystem.
- Rollback means previous immutable application image. Never use `prisma migrate reset` or automatic down migrations in production.
- Cache Components may execute database reads at build time. Docker builds must use a migrated disposable build database with no production/customer data.
- Runtime secrets are injected at deploy time and must never be Docker build arguments or image ENV defaults.

## Phase 18 release-candidate invariants

- `/api/orders` is read-only. Customer order creation MUST go through Cart + `/api/checkout`; do not re-expose the lower-level `createOrder()` use-case as a public HTTP mutation.
- Unauthorized cross-user profile lookup deliberately returns 404 to avoid user-ID existence disclosure.
- Run `npm run audit:release` before release work and `npm run release:gate` when dependencies/browser infrastructure are available.
- A source-level GO is not a production GO. The external evidence gates in `docs/PHASE_18_FINAL_ARCHITECTURE_RELEASE_AUDIT.md` are mandatory.

## UI consistency
- Follow `docs/UI_FORM_SYSTEM.md` for all storefront/admin UI work.
- Feature code uses shadcn primitives from `components/ui/*`; raw visible form controls are not accepted.
- React Hook Form forms validate on change and reuse domain Zod schemas when available.
- Contextual create/edit dialogs are URL-controlled; destructive confirms use `ConfirmDialog`.
- `npm run audit:ui` is an enforced release check.

# Watplux

High-performance solar ecommerce and operations platform built with Next.js 16, React 19, MySQL, Prisma, Better Auth, Tailwind v4 and shadcn/ui.

The application has two deliberately separate experiences:

- **Customer storefront** — browse solar equipment, guest/authenticated cart, checkout, Paystack payment flow, account and order history.
- **Operations** — permission-gated admin workspace for products, variants, categories, brands, inventory, orders, payments and customer access management.

Business authorization remains application-owned (`roles`, `permissions`, `user_roles`). Better Auth owns identity, credential accounts and sessions.

## Requirements

- Node.js `22.23.1` (`nvm use` reads `.nvmrc` without changing your global default).
- MySQL 8.
- Environment variables from `.env.example`.

## Install

```bash
nvm use
npm install
npm run db:generate
npm run db:seed
npm run dev
```

`npm install` is intentionally shown instead of `npm ci` immediately after the Better Auth migration because the dependency lockfile must be regenerated once the new Better Auth packages are downloaded. Commit the regenerated `package-lock.json`, then CI can return to `npm ci`.

## Database

Prisma is retained. Prisma 6 already supports this project's seed workflow and remains the ORM used throughout the commerce domains.

```bash
npm run db:generate
npm run db:seed       # roles/permissions + optional bootstrap super_admin
npm run db:seed:dev   # local development data
```

To bootstrap an operations account, set `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, and optionally `SEED_ADMIN_NAME` before `npm run db:seed`.

## Better Auth migration

See [`docs/BETTER_AUTH_REBUILD.md`](docs/BETTER_AUTH_REBUILD.md) before applying the new migration to an existing database. It deliberately revokes legacy sessions and invalidates old one-time verification/reset tokens because the previous system stored session tokens in a representation that cannot be losslessly converted to Better Auth's session model.

## Quality gates

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:integration
npm run test:e2e
npm run build
```

The architecture is documented under `docs/`; the current source code remains the runtime source of truth.

## Release verification

Phase 16 adds separate Playwright API, desktop-browser, and mobile-browser release projects. Before a release candidate:

```bash
npm run db:generate
npx prisma migrate deploy
npm run test:release
npm run build
```

Install Chromium once on a new test machine with `npx playwright install chromium`. See `docs/PHASE_16_RELEASE_TEST_IMPLEMENTATION.md` and `docs/RELEASE_TEST_CHECKLIST.md`.

## Production deployment (Phase 17)

The production application uses the multi-stage `Dockerfile`:

- `runner` — minimal, non-root Next.js standalone runtime.
- `migrator` — one-shot Prisma migration image, run before web rollout.

Production uses managed MySQL and S3-compatible media storage; the root `docker-compose.yml` remains local-development MySQL only. See `docs/PHASE_17_DEPLOYMENT_OPERATIONS_IMPLEMENTATION.md` and `docs/operations/RELEASE_RUNBOOK.md`.

For Node.js hosting through cPanel, use the separate `npm run build:cpanel`
packaging flow and the versioned-release procedure in
[`deploy/CPANEL.md`](deploy/CPANEL.md). The existing `npm run build` and Docker
release path are unchanged.

Operational endpoints:

- `GET /api/live` — process liveness, no dependency checks.
- `GET /api/ready` — database/configuration readiness for traffic.
- `GET /api/health` — legacy database-aware health endpoint.

## Git and CircleCI

This release-candidate includes a CircleCI release gate and repository-local Git hooks. On a networked development machine, start with:

```bash
./scripts/setup-git.sh git@github.com:YOUR_ORG/YOUR_REPO.git
nvm use
npm install
npm run audit:lockfile
```

Commit the regenerated lockfile before enabling CI. CircleCI intentionally uses `npm ci` and runs migrations, architecture/UI audits, unit/integration/browser tests, and a production Next.js build against disposable CI infrastructure. See `docs/operations/CIRCLECI_GIT_SETUP.md`.

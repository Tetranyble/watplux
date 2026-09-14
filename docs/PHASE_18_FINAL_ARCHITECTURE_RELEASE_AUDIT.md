# Phase 18 — Final Architecture & Release Audit

Status: **SOURCE RELEASE CANDIDATE COMPLETE — PRODUCTION GO/NO-GO REMAINS EXTERNAL-VERIFICATION GATED**

## 1. Scope

Phase 18 audits the repository after Phases 11–17 as one system rather than as isolated feature increments. The audit covers authentication ownership, authorization boundaries, public/machine endpoints, order/payment/inventory invariants, schema/index posture, secrets and deployment operations, compatibility/dead-code exposure, and the final release gate.

## 2. Architecture boundary result

The intended modular-monolith boundaries remain intact:

- Better Auth owns identity, credential accounts, sessions and verification.
- Watplux owns RBAC and business permissions.
- Domain/application use-cases own business invariants; Route Handlers resolve actors/input and delegate.
- Prisma/MySQL is canonical persistence.
- Checkout is the customer order-creation boundary; Payment owns Paystack state transitions and webhooks.
- Inventory remains ledger-driven with guarded stock mutations.
- Media stores metadata in MySQL and bytes in local development/S3-compatible production storage.
- Internal webhook processing is machine-authenticated and independent of browser sessions.
- Production migrations are one-shot release jobs, never web-process startup behavior.

No second authentication/session owner was found. The legacy custom-login/password-reset production use-cases remain absent.

## 3. Security findings fixed in Phase 18

### 3.1 Raw order creation bypass removed — HIGH before fix

`POST /api/orders` survived from the Phase 6 order-domain HTTP slice. After Cart/Checkout/Payment were introduced, leaving that route public allowed a caller to create an order and reserve stock without passing through the authoritative Checkout orchestration or creating the intended payment-attempt lifecycle.

Phase 18 removes the POST handler. `/api/orders` is now an authenticated read collection only. New customer orders are created through:

`POST /api/cart/items -> POST /api/checkout -> Checkout transaction -> PaymentAttempt -> Paystack initialization`

The Playwright order/admin fixtures were moved onto Cart + Checkout so release tests exercise the production path rather than preserving the bypass for test convenience.

### 3.2 User-ID existence disclosure tightened — LOW before fix

`getUserProfile()` documented a non-enumerating ownership policy but returned `ForbiddenError` when another authenticated customer requested a real foreign user ID. That distinguished an existing ID from a missing ID.

The unauthorized foreign-profile case now returns the same `NotFoundError("User not found.")` as a nonexistent user. The IDOR E2E expectation was updated from 403 to 404.

## 4. Route / RBAC audit

All 41 current `/api/admin/**` Route Handlers resolve the authenticated actor with `requireSessionUser()` before delegating to application use-cases. The use-cases remain the real permission boundary and enforce the domain permission (`products.*`, `inventory.*`, `orders.*`, `payments.*`, `consultations.*`, `users.manage`).

The admin layout rejects actors with no business permissions and redirects them to `/account`. Admin navigation is display-only; its six permissioned links map to permissions present in structural RBAC seed data.

Public/mixed endpoints were classified as follows:

- Catalog/media/live endpoints: public reads only.
- Cart endpoints: session or signed server-managed guest-cart ownership.
- Checkout: public/mixed mutation, database-backed abuse limiting, cart ownership, server-side totals/inventory validation.
- Service requests: public/mixed mutation, database-backed abuse limiting and server validation.
- Customer order reads/actions: authenticated ownership or explicit elevated permission in use-cases; guest payment-status paths require order-scoped signed tokens.
- Paystack webhook: public network endpoint but HMAC-authenticated and body-size bounded.
- Webhook worker endpoint: machine secret only, constant-time comparison, no customer/admin session fallback.
- Better Auth route: Better Auth-owned authentication lifecycle with database-backed rate limiting.

## 5. Threat model summary

Primary assets:

- customer identity/session data;
- order and address data;
- product/inventory state;
- payment attempt/refund/webhook state;
- admin authorization assignments;
- media objects and metadata;
- production credentials and signing secrets.

Primary trust boundaries:

1. Browser -> Next.js application.
2. Reverse proxy -> trusted client-IP header.
3. Application -> managed MySQL.
4. Application -> Paystack.
5. Paystack -> webhook endpoint.
6. Scheduler -> internal webhook worker endpoint.
7. Application -> S3-compatible storage.
8. Release automation -> registry/migrator/production infrastructure.

Important mitigations already present include server-resolved actors, domain-level authorization, Argon2 credentials through Better Auth, database-backed auth/public rate limits, CSP/security headers, HMAC webhook verification, bounded webhook body reading, durable/idempotent webhook processing, guarded inventory writes, signed guest order tokens, stable media ownership, non-root/read-only container posture, one-shot migrations and managed backup/PITR policy.

Residual risks requiring live-environment verification are listed in §9.

## 6. Schema and index audit

The schema has explicit uniqueness/guard constraints for the most sensitive invariants, including:

- unique user email and Better Auth account identity;
- one default variant per product;
- one inventory item per variant;
- one active cart per user/guest token;
- one order line per variant per order;
- unique Paystack reference and webhook natural key;
- guarded inventory movement deduplication;
- one service-request queue/index path and assignee queue path;
- request-rate-limit bucket uniqueness.

Phase 13/15 supporting indexes exist for catalog status/facets, default-variant price keyset pagination, live stock filtering, order/admin queues, payment state, webhook processing/health, service-request ownership/assignment and audit lookup.

No new speculative FULLTEXT index was added during the final audit. Current substring search still needs production-size query-plan measurement before changing search technology.

Unused/future schema capabilities such as Reviews/Coupons are not exposed through public runtime routes and were not destructively removed in this phase. Removing already-migrated tables solely to reduce schema line count would add migration risk without reducing an active attack surface.

## 7. Secrets and operational audit

Phase 18 adds `npm run audit:release`, implemented by `scripts/release-audit.mjs`. It statically verifies release-critical invariants including:

- absence of the removed legacy auth runtime files;
- Better Auth remains the auth owner with database rate limiting;
- raw `POST /api/orders` does not return;
- Checkout remains rate-limited and authoritative;
- every admin API route has a session actor boundary;
- admin-navigation permissions exist in RBAC seed data;
- worker route remains machine-auth only;
- non-root production runtime posture;
- release migration path remains one-shot;
- production preflight remains present;
- no obvious committed live secret/private-key material in executable source/config;
- no destructive Prisma reset command in executable operations paths.

Current source audit result: **16/16 passed**.

`npm run release:gate` now combines the architecture audit, Phase 16 release tests and production build:

```bash
npm run audit:release
npm run test:release
npm run build
```

## 8. Dead/compatibility exposure decision

Removed from the production HTTP surface in this phase:

- raw order creation via `POST /api/orders`.

Already removed in Phase 11 and reconfirmed absent:

- custom login/register session owner;
- legacy password reset/email verification token flows;
- old token-delivery compatibility layer;
- `middleware.ts` auth boundary.

Retained deliberately:

- lower-level `createOrder()` application use-case: still useful as a domain primitive/integration-test seam, but no longer directly internet-exposed;
- legacy externally-hosted product image URL compatibility: bounded to image rendering and does not own storage/auth/security state;
- `/api/health`: compatibility/readiness-style diagnostic endpoint, while orchestrators must use `/api/live` and `/api/ready`.

## 9. Final production go/no-go

### Source/architecture gate: GO

The source architecture is coherent enough to be treated as a release candidate. No known high-severity source-level authorization/order/payment bypass remains from this audit.

### Production deployment gate: NO-GO until all items below are evidenced

The project must **not** be declared production-ready solely from source inspection. The following evidence is still mandatory:

1. Fresh dependency installation/lockfile verification succeeds with the pinned Node version.
2. Prisma client generation and all migrations deploy successfully against a disposable/staging MySQL 8-compatible database.
3. `npm run release:gate` passes completely: typecheck, lint, formatting, unit, integration, API/browser/mobile Playwright and production build.
4. Browser release checklist is completed, including keyboard-only, 200% zoom/reflow and screen-reader checkout review.
5. Paystack test-mode end-to-end payment succeeds: initialize -> hosted payment -> signed webhook -> durable worker -> authoritative paid order/inventory state.
6. Refund behavior is verified against real current Paystack payloads. Refund-webhook processing is intentionally still conservative/deferred until payload evidence exists; this is a payment-operations release blocker for enabling production refunds.
7. Production S3-compatible storage is tested for upload/read/cache/delete using the actual provider and credentials.
8. Managed MySQL backups/PITR are enabled and a restore drill succeeds.
9. Production preflight passes with real HTTPS origins and generated secrets.
10. Staging deployment proves `/api/live`, `/api/ready`, worker scheduling, structured logs and rollback to the prior immutable image.
11. Lighthouse/Core Web Vitals are measured in the deployed browser environment; no fabricated performance numbers substitute for this.

When every item above has evidence, the release decision changes from conditional NO-GO to GO without requiring another architecture redesign.

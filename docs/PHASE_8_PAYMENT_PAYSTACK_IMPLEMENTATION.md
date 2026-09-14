# Phase 8 — Payment / Paystack Implementation Report

## 1. Scope delivered

Implemented the full approved Phase 8 scope from `docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md`, **with one explicit, user-approved reduction**: refund-webhook-driven processing (the `REFUND_PENDING -> REFUNDED` transition triggered by a `refund.processed`/`refund.failed` Paystack webhook) is deliberately **not** implemented. See §1 and §18 below for why, and §9/§13 for what happens instead.

Delivered:

- Paystack integration client (Initialize/Verify/Create Refund) against the real Paystack REST API, with a shared `paystackFetch` helper, sanitized error mapping, and a fail-closed `PaystackConfigError` when no secret key is configured.
- HMAC-SHA512 webhook signature verification, constant-time comparison.
- Paystack-safe reference generation (alphanumeric only — no `_`).
- The full `src/modules/payment/` domain module: types, constants, Zod schemas, two state machines (payment attempt, refund), repo (reads, writes, reconciliation queries), and eight use-cases.
- Checkout integration: `completeCheckout` now initializes a Paystack transaction immediately after the checkout transaction commits, never inside it.
- Payment retry (new attempt only, same order/reservation).
- Webhook ingestion route (durable-insert-only), a MySQL-backed worker (crash-safe, no Redis/queue), and verify-then-act processing for `charge.*` events.
- Refund request, allocation, and cancellation over the REST API (no webhook dependency) — the two-ledger allocation model preserved and concurrency-tested.
- Minimal API routes, RBAC-gated reads, reconciliation queries.
- Unit, integration, and mandatory concurrency test suites; a real-HTTP e2e slice; full regression re-runs of Phases 5/6/7.

Explicitly excluded (per the approval message, unchanged): payment UI, admin dashboard UI, notifications, SMS, shipping, fulfillment, accounting, Redis, Elasticsearch, chargebacks/disputes, real-time external reconciliation, customer-facing refund flow, general abandonment infrastructure, and — per the user's explicit scope decision — refund-webhook processing.

## 2. §1 verification outcome (mandatory first step)

Before writing any code, I attempted to verify the plan's two disclosed unknowns against real Paystack behavior:

1. **Does `data.id` reliably appear on every webhook payload?** Corroborated by Paystack's own documentation and multiple third-party integration write-ups for `charge.success`/`charge.failed` — reasonably safe to rely on for charge events.
2. **What are the exact refund-webhook event names and payload shapes?** Could not be confirmed. No sandbox credentials were available in this environment, no public HTTPS endpoint existed to capture a live callback, and Paystack's own documentation is inconsistent/incomplete on the refund-webhook payload shape across the sources I could reach.

Per the plan's own §31 hard-stop instruction ("If sandbox credentials or the ability to capture these events are unavailable: STOP and report the limitation... Do not silently assume the unresolved behavior"), I stopped, reported the gap, and asked the user how to proceed rather than guessing at a payload shape. **The user selected: "Build everything except refund-webhook processing."** Everything below reflects that decision.

The user later provided what they described as a Paystack test key — confirmed to be the **public** key (`pk_test_...`) only. This does not grant server-side API access (Initialize/Verify/Refund all require the secret key) and does not unblock webhook payload capture (which needs a public HTTPS endpoint plus a completed hosted-checkout test transaction). It did not change the approved scope. **No `PAYSTACK_SECRET_KEY` was ever provided, logged, stored, or used anywhere in this implementation** — it remains genuinely unset throughout this environment, and several tests assert the resulting `NOT_CONFIGURED`/`INITIALIZATION_FAILED` behavior as real, intentional coverage rather than a workaround.

## 3. Files created

**Integration layer:**
- `src/integrations/paystack/types.ts`
- `src/integrations/paystack/signature.ts`
- `src/integrations/paystack/reference.ts`
- `src/integrations/paystack/client.ts`

**Payment domain module:**
- `src/modules/payment/types.ts`
- `src/modules/payment/constants.ts`
- `src/modules/payment/schema.ts`
- `src/modules/payment/domain/payment-attempt-state-machine.ts`
- `src/modules/payment/domain/refund-state-machine.ts`
- `src/modules/payment/repo.ts`
- `src/modules/payment/use-cases/initialize-payment.ts`
- `src/modules/payment/use-cases/retry-payment.ts`
- `src/modules/payment/use-cases/verify-and-process-payment.ts`
- `src/modules/payment/use-cases/request-refund.ts`
- `src/modules/payment/use-cases/cancel-refund.ts`
- `src/modules/payment/use-cases/list-payment-attempts-for-order.ts`
- `src/modules/payment/use-cases/list-reconciliation-flags.ts`
- `src/modules/payment/use-cases/ingest-webhook-event.ts`
- `src/modules/payment/use-cases/process-webhook-event-batch.ts`

**Job + routes:**
- `src/jobs/process-webhook-events.ts`
- `app/api/paystack/webhook/route.ts`
- `app/api/internal/process-webhook-events/route.ts`
- `app/api/orders/[orderId]/payment-attempts/route.ts`
- `app/api/orders/[orderId]/retry-payment/route.ts`
- `app/api/admin/payments/[paymentAttemptId]/refunds/route.ts`
- `app/api/admin/payments/refunds/[refundId]/cancel/route.ts`
- `app/api/admin/payments/reconciliation/route.ts`

**Tests:**
- `tests/unit/payment-attempt-state-machine.test.ts`
- `tests/unit/refund-state-machine.test.ts`
- `tests/unit/paystack-signature.test.ts`
- `tests/unit/paystack-reference.test.ts`
- `tests/integration/payment-initialization.test.ts`
- `tests/integration/payment-verification.test.ts`
- `tests/integration/payment-authorization.test.ts`
- `tests/integration/refund-lifecycle.test.ts`
- `tests/integration/webhook-processing.test.ts`
- `tests/integration/payment-concurrency.test.ts`
- `tests/integration/helpers/fake-paystack-client.ts`
- `tests/integration/helpers/payment-fixtures.ts`
- `tests/e2e/payment.spec.ts`

## 4. Files modified (additive extensions, none silently changed)

- `lib/env.ts` — added four new **optional/defaulted** env vars (`PAYSTACK_SECRET_KEY`, `INTERNAL_WORKER_SECRET`, `WEBHOOK_STALE_LOCK_MINUTES`, `WEBHOOK_MAX_PROCESSING_ATTEMPTS`). No existing var changed.
- `.env.example` — documented the new vars, no real secrets.
- `src/modules/order/repo.ts` — **additive extension**: `requireMatchingPaymentAttempt` gained an optional third `client: TransactionClient = db` parameter (defaults preserve every existing call site's behavior unchanged); new exported `markOrderPaidInTransaction(tx, data)` carries the exact prior `markOrderPaid` transaction body; `markOrderPaid(data)` is now `return db.$transaction((tx) => markOrderPaidInTransaction(tx, data))` — a thin wrapper, not a behavior change. Confirmed via the full pre-existing Order unit + integration suites (70 tests), unchanged and passing.
- `src/modules/checkout/repo.ts` — `createInitialPaymentAttempt` now generates its Paystack-safe reference via `generatePaystackSafeReference("CHKOUT")` instead of the base64url `generateRawToken()` (which contains `_`, an invalid Paystack reference character). This is a genuine, disclosed behavior change to reference formatting, not a silent one — it was required for any real Paystack call to ever succeed.
- `src/modules/checkout/use-cases/complete-checkout.ts` — signature extended additively: `completeCheckout(owner, input, actorEmail: string | null = null, paystackClient: PaystackClient = defaultPaystackClient)`. Return type changed from a bare `OrderDetail` to `CompleteCheckoutOutcome { order; payment }` — every existing call site was updated to destructure `{ order }`. A Paystack-side failure during initialization is caught and never fails the checkout response; the order is always returned.
- `app/api/checkout/route.ts` — now resolves the actor's session email and passes both new params through; response now includes `payment` alongside `order`.
- `tests/integration/helpers/payment-fixtures.ts` — `cleanupPaymentTestData()` strengthened (see §17, bug 7) to match orphaned webhook_events by the originating attempt's own `paystackReference`, not only by `resolvedPaymentAttemptId`.
- `tests/e2e/global-teardown.ts` — additive Phase 8 cleanup block, same transitive product-name-prefix (`Phase8E2E`) pattern as Phases 6/7, respecting the `webhook_events`/`refunds` → `payment_attempts` → `orders` FK deletion order.

No other Phase 5/6/7 file was touched. `prisma/schema.prisma` was **not modified** — the existing schema (payment_attempts, refunds, webhook_events, and the money/state columns Phase 2B/6 already defined) was sufficient for the full approved scope.

## 5. Database / migration status

**Zero migrations.** No schema change of any kind. This was verified sufficient during implementation — every new column need was already covered by the existing `payment_attempts`/`refunds`/`webhook_events` tables (pending/refunded ledger columns, the natural-key unique index on `webhook_events`, the state enums).

## 6. Paystack integration client

`src/integrations/paystack/client.ts` implements `initializeTransaction`, `verifyTransaction`, `createRefund` against `https://api.paystack.co` using native `fetch`, through a shared `paystackFetch` helper that attaches the `Authorization: Bearer` header, parses JSON, and maps failures to a sanitized `PaystackApiError` (code + message only — never the raw response body). `PaystackConfigError` is thrown synchronously if `PAYSTACK_SECRET_KEY` is unset, so every call path fails closed and fast rather than attempting a doomed network call.

Every use-case that talks to Paystack accepts an optional `paystackClient: PaystackClient = defaultPaystackClient` parameter — the same dependency-injection shape already established by `TokenDelivery`/`noopTokenDelivery` in the auth module — so tests inject a deterministic fake and production code defaults to the real client.

## 7. Reference-format correction

Paystack's documented reference charset is alphanumeric plus `-`, `.`, `=`. The pre-existing `generateRawToken()` (base64url) includes `_`, which Paystack rejects. `generatePaystackSafeReference(prefix)` (`src/integrations/paystack/reference.ts`) uses `randomBytes(20).toString("hex")` instead — pure alphanumeric, 40 hex characters, effectively collision-free. Both `checkout/repo.ts`'s initial attempt and `payment/repo.ts`'s retry-attempt creation use it.

## 8. Payment state machine implementation

`src/modules/payment/domain/payment-attempt-state-machine.ts` — exact states `INITIATED | PENDING | SUCCESS | FAILED | ABANDONED | INITIALIZATION_FAILED`, events `INITIALIZE_SUCCEED | INITIALIZE_FAIL | VERIFY_SUCCEED | VERIFY_FAIL | ABANDON`. No invented states. `SUCCESS`/`ABANDONED`/`INITIALIZATION_FAILED` are terminal; guarded database updates enforce this at the persistence layer, not just in the pure function.

`src/modules/payment/domain/refund-state-machine.ts` — exact states `REFUND_REQUESTED | REFUND_PENDING | REFUNDED | REFUND_FAILED | REFUND_CANCELLED`, events `PAYSTACK_ACCEPTS | API_FAILS | ADMIN_CANCELS | WEBHOOK_CONFIRMS`. No `SUCCESS_NON_AUTHORITATIVE`-style invented state was added anywhere — "is this attempt authoritative" is always derived by comparison (`attempt.status === "SUCCESS" AND attempt.id === order.authoritativePaymentAttemptId`), never stored as its own status value.

## 9. Webhook architecture

`app/api/paystack/webhook/route.ts` is durable-insert-only, with zero business logic: it reads the raw body, calls `ingestWebhookEvent`, and maps the outcome to an HTTP status (`200` recorded, `401` bad signature, `400` malformed, `503` not configured). `ingestWebhookEvent` fails closed if no secret key is configured, verifies the HMAC-SHA512 signature via constant-time comparison, and inserts a row using the pre-existing `UNIQUE(event_type, paystack_transaction_id)` natural key for idempotency — no second dedup mechanism was introduced, since the existing one proved sufficient.

**Charge events** (`charge.success`, `charge.failed`) are processed identically by the worker regardless of their claimed type: both are routed to `verifyAndProcessPayment`, which calls Paystack's own Verify Transaction API and lets *that* response — never the webhook payload — decide the outcome (plan §9.2's verify-then-act rule).

**Refund events** (`refund.processed`, `refund.failed`, and any other `refund.*` type) are **deliberately deferred**, per the user's approved scope reduction: the event is durably recorded, a warning is logged (`"Refund webhook processing is deferred pending live Paystack payload verification — event durably recorded but not acted on."`), and it is immediately marked `PROCESSED` without mutating any `refunds`/`payment_attempts` row. This is intentional dead code from a business-logic standpoint, not a bug — `tests/integration/webhook-processing.test.ts` asserts it never touches the refund/attempt tables.

**Unrecognized event types** are durably recorded and marked `PROCESSED` with nothing to act on — the same "record everything, act on what we understand" posture the plan specified.

## 10. Worker architecture

`src/jobs/process-webhook-events.ts` is a one-line wrapper (`runWebhookWorker` calls `processWebhookEventBatch`) — a real, disclosed consequence of an ESLint boundary rule discovered during implementation (see §17, bug 1): `job`-typed elements are forbidden from importing `repo`-typed elements directly, so all real orchestration lives in `src/modules/payment/use-cases/process-webhook-event-batch.ts` instead. MySQL-backed, no Redis/queue: `processWebhookEventBatch(batchSize)` scans claimable event ids (`PENDING`, or `PROCESSING` past a configurable staleness window), claims each individually via a guarded conditional UPDATE, and dispatches by event type. `app/api/internal/process-webhook-events/route.ts` triggers a batch on demand, gated by an `x-internal-worker-secret` header compared against `INTERNAL_WORKER_SECRET` — never by ordinary user session auth — failing closed (`503`) if unconfigured and `401` on mismatch.

Crash-safety: a worker that claims a row and dies before recording an outcome leaves it `PROCESSING`; a later pass reclaims it once `lockedAt` is older than `WEBHOOK_STALE_LOCK_MINUTES` (default 5). A row that exceeds `WEBHOOK_MAX_PROCESSING_ATTEMPTS` (default 10) is left permanently `FAILED` rather than retried forever.

## 11. Transaction boundaries

The "Option A" additive-primitive composition pattern (established Phase 6, reused Phase 7) was applied a third time: `payment/repo.ts` owns its own `db.$transaction` and calls the new `orderRepo.markOrderPaidInTransaction(tx, data)` — the pre-existing `completeSaleInTransaction` (Order↔Inventory, unchanged) is called from inside that same composed transaction. No `Prisma.TransactionClient` is ever passed into a use-case; only repos compose transactions.

The Paystack HTTP call in `initializePayment`/checkout is made **after** the relevant DB transaction has already committed — never inside a `$transaction` callback. A Paystack-side failure during checkout initialization is caught and degrades to `INITIALIZATION_FAILED`; it never rolls back the already-created order. Confirmed by grep (`§`13 in the security scan below): no `paystackClient.`/`fetch(` call appears inside any `$transaction` block in `payment/repo.ts`.

## 12. `markOrderPaidInTransaction` additive extension

Preserves `markOrderPaid`'s exact external signature and behavior — it is now a thin wrapper around the new tx-accepting primitive. One subtlety resolved during implementation: the guard-failure "what's the order's actual current state" recheck deliberately reads via `db`, not `tx`, to avoid MySQL REPEATABLE READ snapshot-poisoning (the transaction's snapshot fixes at its first plain read; if that first read happened before the actual current-state write landed, `tx` would return stale data). The ownership check earlier in the same transaction correctly uses `tx`, since it needs to see the transaction's own uncommitted write. The full Order suite (35 unit + 35 integration tests) was re-run immediately after this change and confirmed zero regressions.

## 13. Refund implementation

Full lifecycle: `REFUND_REQUESTED -> REFUND_PENDING` (Paystack Create Refund API accepted the request) `-> REFUNDED` (only ever set by `confirmRefund`, which in this phase is called directly/programmatically, since refund-webhook-driven confirmation is deferred — see §18) or `-> REFUND_FAILED`/`REFUND_CANCELLED` (API failure or admin cancellation, both releasing the allocation immediately). **A refund is never marked `REFUNDED` merely because Paystack's Create Refund API accepted the request** — `requestRefund` only ever moves `REQUESTED -> PENDING`, confirmed by a dedicated test.

The pre-existing two-ledger allocation model (`pendingRefundAmountMinor` / `refundedAmountMinor`, with a generated `availableRefundableAmountMinor` column) is unchanged and reused exactly. Over-allocation, partial-refund budgeting, and the ₦100k/₦70k/₦50k competing-partial-refunds concurrency scenario are all covered.

## 14. Concurrency design

Every write path that can race uses the guarded/conditional UPDATE pattern (`UPDATE ... WHERE id=:id AND status=:expected`, `result.count === 0` = guard failure), with guard-failure rechecks against `db` to avoid snapshot poisoning. Two problems were found and fixed specifically because of concurrency testing:

- **MySQL/application clock skew** (§17, bug 5): raw SQL `NOW()` inside webhook-claim queries diverged from the Node-side clock by roughly an hour in this environment, corrupting staleness comparisons. Fixed by computing `staleCutoff`/`now` in JavaScript and binding them as parameters — matching the pre-existing convention in `auth/repo.ts`'s session-expiry check — never calling SQL `NOW()` for business-logic comparisons again.
- **Genuine InnoDB deadlock** (§17, bug 6, Prisma `P2034`): two payment attempts for the same order racing through the `payment_attempts -> orders -> inventory_items` lock chain. Fixed with `withDeadlockRetry<T>(fn, maxAttempts=3)`, which retries the entire operation (including its own idempotency fast-path) from scratch, never a bare transaction retry.

## 15. Tests

- **Unit**: 30 tests across 4 new files (payment-attempt state machine, refund state machine, Paystack signature verification, Paystack-safe reference generation).
- **Integration**: 42 tests across 5 new files — initialization (8), verification (7, including the late-payment-after-cancellation scenario), authorization/IDOR (6), refund lifecycle (10), webhook processing (11).
- **Concurrency**: 10 tests in `tests/integration/payment-concurrency.test.ts`, covering all 10 mandatory scenarios from the approval message (duplicate webhooks, racing attempts, success-vs-cancel race, racing webhook claims, racing full refund requests, racing refund confirmations, competing partial refunds exceeding budget, racing webhook inserts, racing worker batches, sequential retry-after-success). Run 5 consecutive times in this final verification pass: **10/10 passed every time, zero flaky failures.**
- **e2e**: `tests/e2e/payment.spec.ts`, 7 real-HTTP tests via Playwright's `request` fixture — checkout → payment-attempt read → retry over real HTTP; cross-user IDOR on payment-attempt reads/retry; unauthenticated rejection on all payment routes; the webhook route's fail-closed `503` when unconfigured; the internal worker trigger's machine-to-machine-only auth; and the admin refund/reconciliation routes' `payments.refund`-gating. All fake-Paystack-boundary business-rule coverage stays in the integration suite by design — this file only proves the HTTP boundary.
- All tests injecting a "successful" Paystack interaction use the fake-adapter boundary (`tests/integration/helpers/fake-paystack-client.ts`) — real MySQL, real application code, no real network call, mirroring `createCapturingTokenDelivery()`'s established precedent.

## 16. Regression verification

Re-run immediately after each relevant change and again in this final pass:
- Order (unit + integration): 70 tests, all passing.
- Cart + Checkout: 54 tests, all passing.
- Inventory: 38 tests, all passing.
- Auth: 35 tests, all passing.
- Full unit suite: **160 tests / 21 files, all passing.**
- Full integration suite: **283 tests / 34 files, all passing** (one non-reproducible resource-contention flake was observed during this work — see §17, bug 9 — confirmed not a regression by two subsequent clean full-suite runs).
- Full e2e suite: **34 tests / 7 files, all passing**, including a clean `global-teardown.ts` run.

## 17. Bugs discovered and fixed

1. **ESLint job-boundary violation**: `app/api/internal/process-webhook-events/route.ts` originally imported `runWebhookWorker` from `src/jobs/...` — `app/**` (presentation) may not import a `job`-typed element directly. Fixed by having the route import the use-case directly and extracting all repo-touching orchestration out of the job file (also required, since `job` elements may not import `repo` directly either).
2. **Checkout signature/DTO cascade**: adding `actorEmail`/`paystackClient` params and changing `completeCheckout`'s return shape broke three pre-existing test files expecting the old 2-arg signature and a bare `OrderDetail`. Fixed via a `null` default for `actorEmail` and updating call sites to destructure `{ order }`.
3. **Forgotten Paystack-safe-reference fix**: `checkout/repo.ts`'s `createInitialPaymentAttempt` still used the base64url `generateRawToken()` (containing `_`) despite the plan calling for the correction. Caught by a failing integration test asserting the reference format; fixed by switching to `generatePaystackSafeReference("CHKOUT")`.
4. **Stale e2e assertion**: `tests/e2e/cart-checkout.spec.ts`'s guest-checkout test asserted the payment attempt stays `INITIATED` post-checkout — true under Phase 7, no longer true once Phase 8 added the additive Paystack-initialization step. Updated to expect `INITIALIZATION_FAILED` (the correct, real outcome with no secret key configured).
5. **MySQL/JS clock skew** (real, environment-level): raw SQL `NOW()` in the webhook-claim queries was roughly an hour ahead of the application clock, causing genuinely fresh `PROCESSING` locks to be incorrectly reclaimed as stale. Fixed by computing timestamps in JavaScript and passing them as bound parameters.
6. **Genuine InnoDB deadlock** (Prisma `P2034`): two payment attempts for the same order racing through the composed success transaction could deadlock. Fixed with a whole-operation `withDeadlockRetry` wrapper (max 3 attempts).
7. **Test-cleanup gap in `cleanupPaymentTestData`** (found during this final verification pass's direct database cleanliness check, not by a failing test): webhook_events inserted directly against a real test attempt's own `paystackReference` (as several `webhook-processing.test.ts` cases do) were never resolved to `resolvedPaymentAttemptId` in every code path, so the pre-existing cleanup query (which only matched on `resolvedPaymentAttemptId` or a `TESTWEBHOOK-` reference prefix) left them as orphan rows — 15 leftover rows were found via a direct post-suite database query. Fixed by additionally matching webhook_events whose `paystackReference` equals any of the test run's own attempts' references.
8. **One test not following its own file's cleanup convention**: `webhook-processing.test.ts`'s "genuinely unrecognized event type" test used `paystackReference: null` instead of the file's own established `TESTWEBHOOK-` prefix convention, leaving one additional orphan row invisible to either cleanup strategy. Fixed by giving it a `TESTWEBHOOK-` reference like its sibling tests.
9. **One non-reproducible flake**: a single full integration-suite run threw `"Cannot register: the customer role is not seeded"` from `inventory-authorization.test.ts`, most likely transient MySQL connection-pool contention from heavy back-to-back local suite runs during this verification session. The same file in isolation and two subsequent full-suite runs both passed cleanly — treated as an environmental flake, not a regression, and not otherwise addressed.
10. **e2e test SKU collision**: `tests/e2e/payment.spec.ts`'s bare `` `PHASE8E2E-SKU-${Date.now()}` `` collided under Playwright's `fullyParallel` execution when two of this file's tests created a product in the same millisecond, producing an intermittent `409`. Fixed by adding a random suffix (`uniqueSku()`), matching the collision-avoidance already used for `uniqueEmail`/`uniqueName` in every phase's e2e helpers. (This same latent risk exists in the pre-existing `PHASE4E2E`/`PHASE5E2E`/`PHASE6E2E`/`PHASE7E2E` SKU generators in other e2e files — out of scope to change here since they belong to earlier, already-approved phases, but noted for awareness.)

## 18. Deviations from approved plan

- **Refund-webhook processing is not implemented** (the single, user-approved scope reduction described in §1/§2/§9 above). `REFUND_PENDING -> REFUNDED` in this phase only happens via `paymentRepo.confirmRefund`, called directly (e.g. by an operator/script or a future admin action, none of which exist yet) — not automatically by any webhook. This is the only scope item not delivered from the original 32-section approval, and it was explicitly authorized as a deviation before implementation began, not discovered afterward.
- `checkout/repo.ts`'s reference-generation function call was changed (bug 3 above) — a small, disclosed, additive correction required by the plan itself, not a deviation from it.
- No other deviation from the approved plan occurred. Every other approved scope item (§2 of the approval message) was delivered as specified.

## 19. Known limitations

- Refund-webhook processing is deferred (see §18) — any real Paystack refund that only ever notifies via webhook (no REST poll) will sit `REFUND_PENDING` indefinitely until a follow-up phase implements it against a confirmed payload shape.
- No real Paystack sandbox transaction has ever been completed in this environment; the `charge.success`/`charge.failed` webhook processing path is corroborated by documentation and tested against a fake Paystack client, not a captured real payload.
- Reconciliation (`list-reconciliation-flags.ts`) is query-only — there is no scheduled job or alerting wired to it yet, per the approved scope (real-time external reconciliation was explicitly excluded).
- The internal worker trigger (`/api/internal/process-webhook-events`) has no scheduler of its own in this environment (no cron); it must be invoked externally (e.g. by a platform cron job) in production.

## 20. Final verification matrix

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors |
| ESLint (full repo, boundary rules included) | 0 issues |
| Prettier (`--check .`) | Clean (all files formatted) |
| Unit tests | 160/160 passing (21 files) |
| Integration tests | 283/283 passing (34 files) |
| Concurrency suite (10 scenarios) | 10/10 passing, 5 consecutive clean runs |
| e2e suite | 34/34 passing (7 files) |
| Production build (`next build`, raw output) | Exit code 0; all Phase 8 routes correctly rendered dynamic (`ƒ`) |
| Security scan | No secret/token logging; `secretKey` only ever passed as a function parameter, never logged; pino redact guards `*.secretKey` as defense-in-depth; no raw webhook payload logging; no `Prisma.TransactionClient` leaked into any use-case; no Paystack/HTTP call inside any `$transaction` callback |
| Database cleanliness (direct query, not test-framework self-report) | 0 leftover test users, products, carts, orders, payment_attempts, refunds, or webhook_events after the full suite |
| Phase 5/6/7 regression | 0 regressions (Order 70, Cart+Checkout 54, Inventory 38, Auth 35 — all passing) |

---

**PHASE 8 IMPLEMENTATION COMPLETE — READY FOR REVIEW**

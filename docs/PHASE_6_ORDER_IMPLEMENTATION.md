# Phase 6 — Order/Commerce Domain Implementation Report

## 1. Scope delivered

Everything in the revised, approved `docs/PHASE_6_ORDER_PLAN.md`:

- `src/modules/order/` — full module (domain state machine, domain totals,
  quantity helpers, order-number generator, Zod schemas, types/DTOs, repo,
  8 use-cases).
- 7 admin/customer API routes, exactly matching the plan's use-case list
  (no `markOrderPaid` route — inter-module contract only).
- A narrowly scoped, additive infrastructure extension to
  `src/modules/inventory/repo.ts` (§3 below) — required for cross-module
  transaction composition, explicitly approved in the revised plan.
- No schema/migration change — confirmed sufficient, unchanged from the
  plan's own verdict.
- Unit tests, integration tests (including all mandatory mismatch and
  rollback-proof cases), 7 mandatory concurrency scenarios (run 6× and 5×
  consecutively with zero flaky failures), authorization/IDOR tests, and
  e2e HTTP-boundary tests.
- Two real bugs found and fixed during test-writing (§8), disclosed in
  full, not hidden.

Not built, per the plan's explicit hard stop: Cart, Checkout, Paystack,
webhooks, refunds, fulfillment workflow, shipping/tax/coupon engines,
guest post-checkout auth, TTL-job infrastructure, Redis, Elasticsearch,
storefront UI, admin dashboard, notifications.

## 2. Database change statement

**No migration was created or modified in this phase.** `prisma/schema.prisma`,
`prisma/migrations/`, and the migration history are byte-for-byte
unchanged from Phase 5. Every requirement was satisfiable using the
existing Commerce/Payments domain schema, confirmed in the plan's §1 and
re-confirmed here: no genuine schema deficiency was found during
implementation.

## 3. The Inventory additive extension — exact boundary

Per the approved plan §7 and the implementation-approval message §3, this
is the one precisely scoped exception to "Phase 5 is frozen":

**Unchanged in `src/modules/inventory/repo.ts`**: every existing exported
function's name, signature, and observable behavior
(`reserveInventory`, `releaseInventory`, `completeInventorySale`,
`restockInventory`, `adjustInventoryByDelta`, `adjustInventoryToTarget`,
`recordInventoryReturn`, every read function, every private helper).
**Zero lines of existing code were edited.** Confirmed by re-running
Phase 5's entire test suite (unit + integration + concurrency ×6 + e2e)
immediately after the addition, before writing a single line of Order
code — all passed unchanged (§9).

**Phase 6 transaction-composition infrastructure (additive to Phase 5)**
— three new exported functions appended after `completeInventorySale`,
under their own labeled section:

- `reserveInventoryForNewOrderItem(tx: Prisma.TransactionClient, data: ReserveInventoryData): Promise<InventoryMovement>`
  — order-creation-only variant. No idempotency fast-path or
  guard-failure recheck: it is only ever called with a just-inserted,
  never-before-used `orderItemId`, so the dedup-key collision the
  standalone `reserveInventory`'s idempotency machinery exists to recover
  from cannot occur here.
- `releaseInventoryInTransaction(tx, data: ReleaseInventoryData): Promise<InventoryMovement>`
  — cancellation-composition variant. Idempotent via an explicit
  `db.inventoryMovement.findFirst` pre-check (not a caught constraint
  violation — untested territory in this codebase, deliberately not
  relied on).
- `completeSaleInTransaction(tx, data: CompleteInventorySaleData): Promise<InventoryMovement>`
  — payment-success-composition variant, same idempotency shape as
  `releaseInventoryInTransaction`.

All three reuse the module's existing private helpers
(`requireMatchingOrderItem`, `insertMovement`, `ZERO`) — no duplicated
constants, no new Prisma imports beyond what the file already had. **No
private helper extraction/refactor of the three existing public
functions was performed** — the plan described extraction as one possible
implementation path; the actual implementation chose the more
conservative path of writing three independent new functions, since this
carries strictly less risk of an accidental behavior change to Phase 5's
existing, tested code (zero lines of existing code touched, vs. some
lines touched-but-hopefully-unchanged). This is disclosed as a deviation
from the plan's illustrative implementation sketch, not from its
behavioral requirements — see §11.

## 4. Files created / modified

### New — order module (`src/modules/order/`)

```
constants.ts
quantity.ts
order-number.ts
schema.ts
types.ts
domain/order-state-machine.ts
domain/order-totals.ts
repo.ts
use-cases/create-order.ts
use-cases/cancel-order.ts
use-cases/mark-order-paid.ts
use-cases/get-order-by-id.ts
use-cases/get-order-by-order-number.ts
use-cases/list-my-orders.ts
use-cases/list-orders-for-admin.ts
use-cases/get-order-for-admin.ts
```

### New — presentation layer

```
app/api/orders/route.ts                              (POST createOrder, GET listMyOrders)
app/api/orders/[orderId]/route.ts                     (GET getOrderById)
app/api/orders/[orderId]/cancel/route.ts              (POST cancelOrder)
app/api/orders/by-number/[orderNumber]/route.ts       (GET getOrderByOrderNumber)
app/api/admin/orders/route.ts                         (GET listOrdersForAdmin)
app/api/admin/orders/[orderId]/route.ts               (GET getOrderForAdmin)
```

### New — tests

```
tests/unit/order-state-machine.test.ts     (15 tests)
tests/unit/order-totals.test.ts            (9 tests)
tests/unit/order-quantity.test.ts          (8 tests)
tests/unit/order-number.test.ts            (3 tests)
tests/integration/helpers/order-fixtures.ts
tests/integration/order-creation.test.ts       (9 tests, incl. mandatory rollback proof)
tests/integration/order-cancellation.test.ts   (6 tests)
tests/integration/order-mark-paid.test.ts      (7 tests, incl. 3 mandatory mismatch cases)
tests/integration/order-authorization.test.ts  (8 tests)
tests/integration/order-concurrency.test.ts    (5 tests, covering all 7 named scenarios)
tests/e2e/order.spec.ts                        (5 tests)
```

### Modified — additive only

```
src/modules/inventory/repo.ts   (§3 — 3 new exports, zero existing lines changed)
tests/e2e/global-teardown.ts    (extended with Phase 6's e2e test-data cleanup)
```

No other file was modified.

## 5. Architectural decisions implemented

- **Module naming**: `src/modules/order/` (singular), deliberately
  deviating from `docs/ARCHITECTURE.md` §8's illustrative `orders/`
  (plural), matching the real convention every existing module
  (`catalog`, `inventory`, `auth`) uses — per the plan's own §3 decision.
- **Domain layer purity**: `order-state-machine.ts`/`order-totals.ts`
  never throw — they return `null`/plain values, matching
  `src/modules/catalog/domain/money.ts`'s established convention exactly
  (confirmed by inspection before writing either file, not assumed).
- **Cross-module data resolution**: `order/repo.ts` reads
  `product_variants`/`products` directly via Prisma to resolve order-line
  snapshots, mirroring Inventory's own established precedent of reading
  `order_items` directly from its own `repo.ts` — the "only repo.ts
  touches Prisma" rule governs *which layer*, not *which module's
  tables*, since there is one Prisma client for the whole application.
- **`getAvailableQuantity` reuse**: `createOrder`'s non-authoritative
  pre-check calls Inventory's existing, framework-agnostic, unauthenticated
  read use-case directly — exactly the cross-module use-case-to-use-case
  composition it was built for in Phase 5.
- **Order number generation**: `ORD-YYYYMMDD-XXXXXX` (date prefix +
  random alphanumeric suffix, 19 characters, well under the column's
  `VarChar(30)`), not sequential — matches the plan's §21 proposal exactly
  as approved.

## 6. Transaction boundaries and concurrency mechanisms

**Order creation** (`repo.ts`'s `createOrder`): one `db.$transaction` —
`orders` insert (nested `order_items`/`order_addresses` creates) →
`reserveInventoryForNewOrderItem` per line, composed into the *same*
transaction via the additive Inventory export → `order_status_history`
insert → commit. Required ordering (order before reservation) is enforced
by the existing FK (`inventory_movements.order_item_id -> order_items.id`),
not merely a design choice.

**Cancellation** and **`markOrderPaid`**: both use the identical
conditional-`UPDATE`-on-`orders` mechanism `docs/ARCHITECTURE.md` §6.5
already established — `UPDATE orders SET status = :new WHERE id = :id
AND status = :expected`, `result.count === 0` triggers a guard-failure
recheck. This is the **single, uniform** concurrency primitive underlying
every order-level race in this module — the same guarded-UPDATE shape
Inventory already built and tested for `inventory_items`, applied here to
`orders`.

## 7. The payment-attempt ownership guard

`requireMatchingPaymentAttempt(orderId, paymentAttemptId)` (private,
`order/repo.ts`) — runs via `db`, before `markOrderPaid`'s transaction
opens:

1. Payment attempt exists (`NotFoundError` if not).
2. `paymentAttempt.orderId === orderId` (`ValidationError` if not — this
   is the exact bug shape Phase 5's `requireMatchingOrderItem` addressed:
   a FK proves existence, never correct association).
3. `paymentAttempt.status === "SUCCESS"` (`ValidationError` if not).

Verified safe to run via a plain read (not race-sensitive) because both
fields checked are effectively immutable for this purpose:
`payment_attempts.order_id` is set once at creation and never updated by
any code path in this codebase; `status` transitioning to `SUCCESS` is a
one-way, terminal fact the (future) calling Payment module will have
already independently verified via Paystack before ever invoking this
function. This is distinct from, and composes with, the pre-existing
double-payment race handling (the conditional `UPDATE` + `@unique`
constraint on `authoritative_payment_attempt_id`) — the ownership guard
rejects *mismatched* inputs before either race mechanism ever runs;
double-payment races between two *genuinely matching* attempts are
resolved exactly as documented in the plan §12, unchanged.

## 8. Bugs found and fixed during test-writing (disclosed in full)

### Bug 1 — `cancelOrder`'s state-machine pre-check rejected its own idempotent-success case

**Found by**: `order-cancellation.test.ts`'s "cancelling an
already-CANCELLED order is idempotent" test, on first run.

**The bug**: `cancel-order.ts`'s use-case-level pre-check called
`nextState(existing.status, "CANCEL")` and threw `ValidationError` if the
result was `null`. Since `CANCELLED` has no outgoing transitions,
`nextState("CANCELLED", "CANCEL")` is `null` by design — meaning a
**second** cancel call on an already-cancelled order was rejected by this
pre-check with a `ValidationError`, before it ever reached
`orderRepo.cancelOrder`'s own guard-failure recheck (which correctly
treats "already `CANCELLED`" as an idempotent success). The use-case's
fast pre-check was stricter than the repo's actual contract.

**Fix**: the pre-check now explicitly skips itself when
`existing.status === "CANCELLED"`, letting that specific case fall
through to the repo's idempotent handling; every other invalid-state case
(e.g. a `DELIVERED` order) is still rejected immediately by the pre-check
as before.

**Verification**: `order-cancellation.test.ts`'s idempotent-cancel test
passes, and all other cancellation/authorization tests continue to pass
after the fix (re-run in full).

### Bug 2 — my own e2e test had a stale session bug (test-only, not application code)

**Found by**: the first run of `order.spec.ts`'s happy-path test.

**The bug**: after cancelling an order as the customer, the test called
the admin-only inventory-balance endpoint without logging back in as the
admin — the customer session (still active) correctly received a 403, and
the test's own assertion on the (missing) response body threw a
`TypeError`, not a meaningful test failure.

**Fix**: added an explicit re-login as the admin before calling the
admin-only endpoint, matching the pattern already used in the file's
other admin-facing test.

This is a test-authoring bug, not an application bug — disclosed for
completeness per the "do not hide implementation discoveries" instruction,
not because it reflects a defect in `src/` or `app/`.

## 9. Phase 5 regression verification

Run immediately after adding the three additive Inventory exports, before
any Order code existed:

| Suite | Result |
|---|---|
| Inventory unit tests | 21/21 passed |
| Inventory integration tests (4 files) | 38/38 passed |
| Inventory e2e tests | 4/4 passed |

Re-run again at the end of the full Phase 6 implementation, as part of
the full repo-wide suites (§13) — still 100% passing, confirming the
additive change caused zero regression at either checkpoint.

## 10. Test coverage

| Suite | File(s) | Count |
|---|---|---|
| Unit — state machine | `tests/unit/order-state-machine.test.ts` | 15 |
| Unit — totals | `tests/unit/order-totals.test.ts` | 9 |
| Unit — quantity | `tests/unit/order-quantity.test.ts` | 8 |
| Unit — order number | `tests/unit/order-number.test.ts` | 3 |
| Integration — creation (incl. mandatory rollback proof) | `tests/integration/order-creation.test.ts` | 9 |
| Integration — cancellation | `tests/integration/order-cancellation.test.ts` | 6 |
| Integration — markOrderPaid (incl. 3 mandatory mismatch cases) | `tests/integration/order-mark-paid.test.ts` | 7 |
| Integration — authorization/IDOR | `tests/integration/order-authorization.test.ts` | 8 |
| Integration — concurrency (7 named scenarios) | `tests/integration/order-concurrency.test.ts` | 5 |
| E2E | `tests/e2e/order.spec.ts` | 5 |

Full repo-wide totals after this phase: **108 unit / 177 integration / 22
e2e**, all passing.

## 11. Concurrency verification (all 7 mandatory scenarios)

Each test inspects final DB state directly via fresh queries — never
inferred from promise resolution alone.

1. **Two checkouts competing for the last inventory unit** — exactly one
   order created, exactly one `RESERVE` movement, `quantityAvailable = 0`.
2. **Two concurrent cancellations of the same order** — both calls
   resolve (idempotent), exactly one `RELEASE`, exactly one `CANCELLED`
   history row.
3. **+ 4. Cancellation racing payment success** — implemented as **one**
   genuinely-raced test with branching assertions covering both named
   orderings ("cancellation wins" and "payment wins"), rather than two
   separate tests with artificial timing bias. Forcing a specific winner
   deterministically would require either a fake sequential ordering
   (misrepresenting the real race) or fragile timing hacks; the single
   test asserts the correct, self-consistent invariant for *whichever*
   outcome the real race produces, verified across 6 consecutive runs (no
   run ever produced a state outside the two valid outcomes). **This is a
   disclosed deviation from "two separate scenarios" in the
   implementation-approval message's literal phrasing — see §12.**
5. **Duplicate `markOrderPaid` calls (genuinely concurrent)** — both
   resolve, exactly one `transitioned: true`, exactly one `SALE` movement.
6. **Payment-attempt/order mismatch under concurrency** — the valid call
   succeeds, the mismatched call is still rejected (the ownership check
   is a relational pre-check, not a locking race, so it is unaffected by
   interleaving), neither order corrupted.
7. **Transaction-composition rollback proof** — lives in
   `order-creation.test.ts` (a deliberate FK-violation injected after the
   inventory reservation step, before the final `order_status_history`
   insert, confirms full rollback of everything including the
   reservation) — included in the same repeated-run verification as the
   dedicated concurrency file, not duplicated into it.

**Run 6 times consecutively** (concurrency file) and **5 times
consecutively** (rollback-proof test): zero flaky failures across all
runs, every scenario passing every time — exceeding the mandatory 5×
requirement for both.

## 12. Deviations from the approved plan (complete list, nothing omitted)

1. **The Inventory additive extension was implemented as three
   independent new functions, not an extraction-and-rewrap of the three
   existing functions** (§3) — a more conservative implementation choice
   than the plan's illustrative sketch, carrying strictly less risk to
   Phase 5's existing code. The *behavioral* requirement (tx-accepting
   primitives, additive only, zero change to existing exports) is met
   exactly; only the *internal construction technique* differs from the
   plan's suggestion.
2. **Concurrency scenarios 3 and 4 ("cancellation wins" / "payment wins")
   are covered by one genuinely-raced test with branching assertions**
   (§11), not two separate deterministic tests. Forcing a specific winner
   would require artificial bias not present in the real system; the
   single test verifies the correct invariant for both real, observed
   outcomes.
3. **`getOrderByOrderNumber` is routed** (`GET /api/orders/by-number/[orderNumber]`)
   — the plan's own route-count instruction for this phase was "minimal,"
   without an exact enumerated list (unlike Phase 5's exact "6 routes
   only"); this additional read-only, already-planned-as-a-use-case route
   was included since it rounds out the read surface at negligible risk
   (no mutation, already-built use-case, already covered by both
   integration and e2e tests).
4. **Two real bugs found and fixed during testing** (§8) — both
   disclosed in full above, not glossed over.

No deviation required a schema or migration change, and none altered any
Phase 5 behavior, contract, or test.

## 13. Complete verification results

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| ESLint (full repo) | Clean |
| Prettier `--check` (full repo) | Clean |
| Unit tests (full repo) | 108/108 passed |
| Integration tests (full repo, 22 files) | 177/177 passed |
| Phase 5 regression (checkpoint after additive Inventory change) | 21 unit + 38 integration + 4 e2e, 100% passed |
| Concurrency tests (order-concurrency.test.ts × 6 consecutive runs) | 30/30 passed, zero flakiness |
| Rollback-proof test (order-creation.test.ts × 5 consecutive runs) | 45/45 passed, zero flakiness |
| E2E tests (full repo, 6 files) | 22/22 passed |
| Production build (`next build`, raw/unfiltered) | Exit 0; all order routes correctly listed as dynamic (`ƒ`) |
| ESLint architectural-boundary re-test | Fired correctly on a deliberate violation in `app/api/orders/route.ts`; reverted; re-confirmed clean |
| Security source scan | Clean — no unparameterized SQL, no missing auth checks, no secrets, no Paystack/webhook code references (comments only), correct Prisma-import boundary, no invented permissions |
| Database-cleanliness check | Zero leftover rows in `orders`/`order_items`/`order_addresses`/`order_status_history`/`payment_attempts`/`inventory_items`/`inventory_movements`/test users after every suite ran |

## 14. Benign tooling/runtime artifacts investigated

The production build logs a `HANGING_PROMISE_REJECTION` error for
`/api/admin/orders` during static-generation attempts, identical in shape
to the pre-existing artifact already investigated and confirmed harmless
for `/api/admin/catalog/products` and `/api/admin/inventory` in Phase
4/5's own implementation reports — Next.js's static-page-generation
attempt on any route using `cookies()` produces this log line, but the
route is still correctly compiled and listed as dynamic (`ƒ`) in the
final build output, and functions correctly at runtime (confirmed by the
e2e suite hitting it successfully). Not a new artifact this phase
introduced; re-confirmed rather than re-investigated from scratch.

## 15. Known limitations

- **Order-creation deduplication** — no mechanism exists; explicitly
  deferred to a future Cart/Checkout phase per the plan's own §13/§25.
- **Guest post-checkout order lookup** — no session exists to check
  ownership against for a guest order after their browser session ends;
  flagged as an open design question in the plan, not solved here.
- **`PAID -> CANCELLED` (admin refund-flow) transition** — the state
  machine knows this transition exists; no use-case implements it (needs
  Refund/Paystack machinery excluded from this phase).
- **TTL-sweep job** — `cancelOrder` is designed to be safely callable by
  such a job (`actorType: SYSTEM`), but no job-runner infrastructure
  exists anywhere in this codebase yet.
- **Coupon/tax/shipping-rate engines** — the total-formula fields
  (`orders.discountMinor`/`taxMinor`/`deliveryFeeMinor`) are wired
  correctly into the arithmetic but always evaluate to `0` in this phase,
  since no coupon-redemption, tax-jurisdiction, or shipping-rate logic is
  built.
- **`markOrderPaid`/inter-module contracts have no real caller yet** — a
  future Payment module doesn't exist; these are exercised only by direct
  test calls, matching exactly how Phase 5's own inter-module contracts
  were verified before Order existed.

## 16. Final verification matrix (summary checklist)

- [x] Phase 5 business behavior, public API, and tests unchanged —
      verified by full regression run before and after Order was built.
- [x] Order creation and initial inventory reservation are one atomic
      transaction — proven via the mandatory rollback-proof test.
- [x] `markOrderPaid` verifies payment-attempt/order association and
      `SUCCESS` status before any mutation — proven via 3 mandatory
      mismatch tests + 1 concurrency scenario.
- [x] Late payment success after cancellation never resurrects an order —
      proven directly.
- [x] Double-payment races resolve to exactly one authoritative attempt —
      proven directly (sequential) and under concurrency.
- [x] No generic status-mutation endpoint exists anywhere in this module.
- [x] No new RBAC permission was added.
- [x] IDOR protection matches the established `getUserProfile` template
      exactly (404 nonexistent / 403 forbidden).
- [x] All money in integer minor units; all quantities `DECIMAL(12,3)`
      via `Prisma.Decimal`; computed totals satisfy
      `chk_orders_total_arithmetic` by construction.
- [x] No Cart, Checkout, Paystack, webhook, refund, fulfillment, tax,
      shipping, or coupon-application logic was built.
- [x] Database left completely clean after every test suite.

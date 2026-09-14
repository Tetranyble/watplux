# Phase 7 — Cart + Checkout Domain Implementation Report

**Status: IMPLEMENTATION COMPLETE.** Built exactly per the approved
`docs/PHASE_7_CART_CHECKOUT_PLAN.md`, with two disclosed deviations (§18)
and no schema/migration change.

---

## 1. Scope delivered

- **Cart module** (`src/modules/cart/`): state machine, quantity
  validation, guest-token identity resolution, cart repository (reads,
  cart-row-lock mutations, guest↔user merge, checkout-composable
  primitives), 7 use-cases, 4 API routes.
- **Checkout module** (`src/modules/checkout/`): schema, DTOs, a repo
  owning the single composed transaction plus the initial
  `payment_attempts` insert, 2 use-cases (`validateCheckout`,
  `completeCheckout`), 2 API routes.
- **Order additive extension**: `createOrderInTransaction(tx, data)` in
  `src/modules/order/repo.ts` — `createOrder` is now a thin wrapper
  around it, zero observable behavior change.
- **Auth integration**: guest-cart merge wired into `login`'s success
  path only (see §18, deviation 1).
- Nothing beyond this scope was built: no Paystack call, no webhook, no
  refund, no payment-retry use-case, no storefront UI, no admin cart
  dashboard, no Redis/Elasticsearch, no new schema/migration.

---

## 2. Files created / modified

### Created

```
src/modules/cart/constants.ts
src/modules/cart/quantity.ts
src/modules/cart/merge.ts
src/modules/cart/schema.ts
src/modules/cart/types.ts
src/modules/cart/repo.ts
src/modules/cart/domain/cart-state-machine.ts
src/modules/cart/use-cases/get-active-cart.ts
src/modules/cart/use-cases/get-cart-item-count.ts
src/modules/cart/use-cases/add-cart-item.ts
src/modules/cart/use-cases/update-cart-item-quantity.ts
src/modules/cart/use-cases/remove-cart-item.ts
src/modules/cart/use-cases/clear-cart.ts
src/modules/cart/use-cases/merge-guest-cart-into-user-cart.ts
src/modules/cart/use-cases/resolve-guest-cart-identity.ts
src/modules/checkout/schema.ts
src/modules/checkout/types.ts
src/modules/checkout/repo.ts
src/modules/checkout/domain/checkout-line-classification.ts
src/modules/checkout/use-cases/validate-checkout.ts
src/modules/checkout/use-cases/complete-checkout.ts
lib/cart-actor.ts
app/api/cart/route.ts
app/api/cart/count/route.ts
app/api/cart/items/route.ts
app/api/cart/items/[itemId]/route.ts
app/api/checkout/validate/route.ts
app/api/checkout/route.ts
tests/unit/cart-state-machine.test.ts
tests/unit/cart-quantity.test.ts
tests/unit/cart-merge.test.ts
tests/unit/checkout-line-classification.test.ts
tests/integration/helpers/cart-fixtures.ts
tests/integration/cart-management.test.ts
tests/integration/cart-merge.test.ts
tests/integration/cart-authorization.test.ts
tests/integration/checkout-flow.test.ts
tests/integration/checkout-authorization.test.ts
tests/integration/cart-checkout-concurrency.test.ts
tests/e2e/cart-checkout.spec.ts
docs/PHASE_7_CART_CHECKOUT_IMPLEMENTATION.md   (this file)
```

### Modified

```
src/modules/order/repo.ts            — additive `createOrderInTransaction`; `createOrder` is now a thin wrapper (§10)
src/modules/auth/use-cases/login.ts  — additive guest-cart-merge call on the success path (§6/§18)
app/api/auth/login/route.ts          — reads/clears the guest-cart cookie around `login()`
tests/e2e/global-teardown.ts         — added the Phase7E2E cleanup block
```

### Untouched (confirmed)

`prisma/schema.prisma` — **zero changes**. `src/modules/inventory/**`,
`src/modules/order/domain/**`, `src/modules/order/use-cases/**`, every
existing Order/Inventory/Auth/Catalog route — **zero changes** beyond the
two additive edits listed above.

---

## 3. Database changes

**None.** No migration was created or required. The existing
`carts`/`cart_items` schema (migration `20260808134322_commerce_domain`)
was sufficient for every use-case, mutation, and invariant this phase
needed, confirmed by direct schema inspection before writing any code
(plan §1) and by the full test suite passing without any generated-column
or constraint change.

---

## 4. Cart architecture

- **Ownership**: `CartOwner = { type: "user"; userId } | { type: "guest"; guestTokenHash }`
  (`src/modules/cart/types.ts`), resolved server-side only, mirroring
  `chk_carts_identity_exclusive`'s exact two-axis shape.
- **Identity resolution**: `lib/cart-actor.ts`'s `resolveCartActor()` —
  session first, then the guest cookie (only if its hash resolves to a
  real cart), else `{ type: "none" }`. `resolveOrCreateCartOwner()` is
  the one mutation-only variant that promotes `"none"` into a fresh guest
  identity, used exclusively by `POST /api/cart/items`.
- **Lazy creation**: `cartRepo.getOrCreateActiveCartId` — the
  insert-or-recover-from-duplicate-key race prescribed by
  `docs/DATABASE_DESIGN.md` §22, run via `db` before any mutation
  transaction opens.
- **State machine**: `src/modules/cart/domain/cart-state-machine.ts` —
  `ACTIVE -> CONVERTED | ABANDONED`, both terminal, mirroring
  `order-state-machine.ts`'s shape exactly. `ABANDON` is schema-aware but
  unreachable in this phase (no job runner exists — plan §33 open
  question 4, unchanged).

---

## 5. Guest-token implementation

Exactly per plan §4 — no new mechanism invented:

- `generateRawToken()`/`hashToken()` reused verbatim from
  `src/integrations/crypto/tokens.ts`.
- Cookie name: `guest_cart_token` (`src/modules/cart/constants.ts`).
- Cookie attributes identical to `setSessionCookie`: `httpOnly`,
  `secure` in production, `sameSite: "lax"`, `path: "/"`, explicit
  `expires` (30-day default, plan §33 open question 1).
- Raw token never stored, never logged — only its SHA-256 hash. Verified
  by source scan (§14 below).

---

## 6. Cart merge implementation

`cartRepo.mergeGuestCartIntoUserCart(userId, guestTokenHash)` — the exact
policy from plan §6: quantities summed via the pure
`computeMergedCartLines` function (`src/modules/cart/merge.ts`, unit
tested in isolation), inactive/archived guest variants dropped, guest
cart marked `CONVERTED`. Two cart-row locks acquired in ascending numeric
ID order to prevent deadlock (plan §6/§11). Triggered from `login`'s
success path only — see the disclosed deviation in §18.

---

## 7. Cart concurrency design

Single, uniform primitive: `SELECT id FROM carts WHERE id = ? AND status
= 'ACTIVE' FOR UPDATE` as the literal first statement of every
cart-mutating transaction (`lockActiveCartOrThrow` in `cart/repo.ts`).
Item-level ownership is enforced by a compound `WHERE id = ? AND cartId
= ?` on the `updateMany`/`deleteMany` itself — no separate
check-then-act. Add-to-cart uses an atomic `upsert` with `{ increment }`
against `uq_cart_items_cart_variant` (plan §12). All ten mandatory
concurrency scenarios are covered — see §16.

---

## 8. Checkout architecture

`src/modules/checkout/` is a thin orchestration module: `checkout/repo.ts`
owns the ONE outer transaction and composes Cart's and Order's own
tx-accepting primitives (plan §14/§17):

```
Route
 -> Checkout use-case (validateCheckout / completeCheckout)
 -> checkout/repo.ts  — opens the ONE transaction, holds the cart lock
     -> cart/repo.ts    (lockOwnedActiveCartInTransaction, convertCartInTransaction)
     -> order/repo.ts   (createOrderInTransaction, additive)
         -> inventory/repo.ts (reserveInventoryForNewOrderItem, unchanged from Phase 6)
 -> Prisma -> MySQL
```

`validateCheckout` is a genuinely read-only preview (no transaction
beyond simple reads); `completeCheckout` performs the full transaction
then creates the initial payment attempt as a separate, non-transactional
step.

---

## 9. Checkout transaction composition

`checkoutRepo.completeCheckout`'s transaction, in exact sequence:

1. `cartRepo.lockOwnedActiveCartInTransaction(tx, cartId, owner)` — the
   transaction's first statement; locks the row, verifies ownership and
   `ACTIVE` status, returns items (throws `NotFoundError`/`ConflictError`/
   `ValidationError` for not-found/not-yours/not-active/empty).
2. Per line: `orderRepo.resolveOrderLine(variantId)` (a plain `db` read,
   safe after the lock — see the code comment in `checkout/repo.ts` for
   why this doesn't reintroduce snapshot poisoning).
3. Totals computed via a small, deliberate **inline duplication** of
   `order/domain/order-totals.ts`'s formula (not imported — `repo.ts`
   cannot import `domain/`, confirmed by ESLint; see §18 deviation 2).
4. `orderRepo.createOrderInTransaction(tx, {...})` — creates the order,
   its items/addresses, and reserves inventory per line (unchanged Phase
   6 internal ordering).
5. `cartRepo.convertCartInTransaction(tx, cartId)` — the guarded
   `ACTIVE -> CONVERTED` transition, confirming the lock held.
6. Commit.
7. **Outside** the transaction: `createInitialPaymentAttempt(orderId,
   totalMinor)` — a plain single-row insert, no external call.

Any failure at any step rolls back everything: no order, no order items,
no reservation, no cart-status change — proven directly by the mandatory
rollback-proof test (§16).

---

## 10. Order additive extension

`order/repo.ts` gained `createOrderInTransaction(tx, data)`, containing
exactly the body `createOrder`'s own `db.$transaction` callback had
before this phase. `createOrder(data)` is now:

```ts
export async function createOrder(data: CreateOrderData) {
  return db.$transaction((tx) => createOrderInTransaction(tx, data));
}
```

Zero signature/return-type/behavior change, confirmed by re-running
Order's entire existing test suite (35 unit + 35 integration tests)
immediately after this addition, before any Checkout code existed — all
70 passed unchanged (§16).

---

## 11. Inventory interaction

Cart never calls any Inventory mutation (`reserveInventory`,
`reserveInventoryForNewOrderItem`, `releaseInventory`,
`completeSaleInTransaction`) — verified by source scan (§14) and by a
dedicated integration test asserting zero `inventory_movements` rows
after any cart mutation. Reservation happens exclusively inside
Checkout's composed transaction, via Order's own unchanged
`reserveInventoryForNewOrderItem` call.

---

## 12. Checkout idempotency

Exactly the mechanism plan §15 specified: the cart's own guarded
`ACTIVE -> CONVERTED` transition is the entire idempotency primitive. No
`idempotency_keys` table, no client-supplied key, no new column. Verified
directly by concurrency scenarios 1, 2, and 10 (§16): two genuinely
concurrent `completeCheckout` calls against the same cart always produce
exactly one order; a sequential retry after a successful commit finds no
`ACTIVE` cart and cleanly returns `NotFoundError` (the disclosed
convenience limitation from missing `orders.cartId` — plan §15/§33,
unchanged, not solved in this phase).

---

## 13. Payment-attempt boundary

`checkoutRepo.createInitialPaymentAttempt` — Option A, exactly as
approved: creates a `payment_attempts` row with `status: "INITIATED"`, a
freshly generated reference (`CHKOUT-<generateRawToken()>`),
`amountMinor` set to the order's `totalMinor`. No `authorizationUrl`, no
`accessCode`, no Paystack call, no verification logic — confirmed by a
dedicated integration test and an e2e test both asserting these fields
are `null`/absent.

---

## 14. Security / IDOR

Source-scan results (all pass):

- No raw guest-cart token, session token, password, or Paystack secret is
  ever passed to the logger — confirmed by grep across `src/modules/cart`,
  `src/modules/checkout`, `lib/cart-actor.ts`.
- No `console.log`/`console.debug`/`console.info` anywhere in the new
  code.
- No `priceMinor`/`priceSnapshotMinor`/`totalMinor`/`subtotalMinor`/
  `discountMinor` field exists in any Cart/Checkout Zod schema — the
  client cannot submit them even by trying.
- No `userId`/`guestTokenHash` is ever read from a request body in any
  Cart/Checkout route — identity is always server-resolved.
- No `Prisma.TransactionClient` type appears in any use-case file.
- No `next/headers` import outside `lib/cart-actor.ts`.
- No `fetch`/`axios`/raw HTTP call anywhere in Cart/Checkout; the only
  `paystack` references are the pre-existing `paystackReference` column
  name and comments marking Phase 8 scope.

IDOR scenarios (mandatory table, plan §27) — all verified in
`tests/integration/cart-authorization.test.ts` and
`checkout-authorization.test.ts`:

| Scenario | Result |
|---|---|
| User A -> User B's cart item | 403 (item exists, not theirs) |
| Guest A -> Guest B's cart item | 403 |
| User <-> Guest cross-identity | 403 |
| Forged/nonexistent item id | 404 |
| Forged/nonexistent guest token hash | resolves to no identity, no error, enumeration-safe |
| User A's checkout reaching User B's cart | structurally impossible (no `cartId` input) + defense-in-depth repo check returns 404 for a hypothetically forged internal call |

**One real bug found and fixed during this pass** (not a design flaw,
an implementation ordering bug): `updateCartItemQuantity`/`removeCartItem`
originally checked "does the caller have an active cart" *before*
resolving the target item, so a caller with no cart of their own got a
misleading `404` instead of the correct `403` for an item that genuinely
exists but belongs to someone else. Fixed by resolving the item first,
the caller's own cart second — see §17.

---

## 15. Tests

| Layer | File | Count |
|---|---|---|
| Unit | `cart-state-machine.test.ts` | 5 |
| Unit | `cart-quantity.test.ts` | 6 |
| Unit | `cart-merge.test.ts` | 7 |
| Unit | `checkout-line-classification.test.ts` | 4 |
| Integration | `cart-management.test.ts` | 16 |
| Integration | `cart-merge.test.ts` | 7 |
| Integration | `cart-authorization.test.ts` | 5 |
| Integration | `checkout-flow.test.ts` | 14 |
| Integration | `checkout-authorization.test.ts` | 3 |
| Integration | `cart-checkout-concurrency.test.ts` | 8 |
| E2E | `cart-checkout.spec.ts` | 5 |

**Phase 7 total: 80 new tests, all passing.** Combined with the
pre-existing suite: 130 unit tests, 230 integration tests (28 files), 27
e2e tests — all green, zero regressions.

---

## 16. Concurrency results

All 10 mandatory scenarios from the plan are exercised
(`cart-checkout-concurrency.test.ts`, 8 tests — scenarios 2 and 10 are
each their own test; scenarios 8/9 are covered by
`checkout-flow.test.ts`'s own rollback-proof test, mirroring
`order-concurrency.test.ts`'s identical "not duplicated here" convention
for its own rollback-proof test):

1. Two identical checkout requests, same cart — exactly one order. ✅
2. Hypothetical differing idempotency keys — collapses to (1). ✅
3. Checkout vs. quantity update — both orderings verified self-consistent. ✅
4. Checkout vs. item removal — both orderings verified self-consistent. ✅
5. Concurrent add-to-cart, same variant (incl. concurrent first-ever-cart race) — exactly one row, correct sum. ✅
6. Guest merge vs. checkout on the same guest cart — loser cleanly no-ops/rejects. ✅
7. Two checkouts competing for the last inventory unit — exactly one order. ✅
8/9. Failure after reservation / before conversion — structurally impossible to observe as partial (rollback-proof test in `checkout-flow.test.ts`). ✅
10. Sequential retry after success — no second order, clean 404. ✅

**Run 5 consecutive times: 8/8 passed every time, zero flaky failures.**

Every test asserts final database state via a fresh query — never
inferred from which promise resolved/rejected alone.

---

## 17. Bugs discovered and fixed

Per the project's established bug-disclosure standard — every one
reproduced, explained, fixed, regression-tested, and the affected suite
re-run:

1. **Substring-hint bug in the cart-creation race recovery**
   (`cart/repo.ts`). `ownerUniqueIndexHint` returned `"active_cart_user"`/
   `"active_cart_guest"`, but the real constraint names are
   `uq_one_active_cart_per_user`/`uq_one_active_cart_per_guest_token` —
   neither hint is an actual substring (`_per_` sits between "cart" and
   "user"/"guest"). This silently defeated the entire "insert, or recover
   from the concurrent creator's duplicate key" mechanism: a real P2002
   propagated uncaught instead of being recovered from. **Found by**
   concurrency scenario 5 (concurrent add-to-cart, same variant, no
   pre-existing cart). **Fixed** by correcting both hints to
   `"active_cart_per_user"`/`"active_cart_per_guest"` (also fixed in the
   merge function's own hardcoded hint). **Regression test**: scenario 5
   now passes deterministically across 5 consecutive runs.

2. **Snapshot-read ambiguity in the merge transaction's guest-cart
   re-check** (`cart/repo.ts`). The post-lock re-check of the guest
   cart's status (`freshGuestCart`) and the user-cart-creation race's
   recovery read both used `tx.` reads. Empirically, under a genuine
   merge-vs-checkout race, this intermittently missed a
   concurrently-committed conversion (concurrency scenario 6 observed
   `merged: true` even when checkout had already converted the same
   cart). **Fixed** by switching both reads to `db.` (a fresh, separate
   connection/snapshot) — the same "guard-failure recheck reads via `db`,
   never `tx`" pattern Inventory's `reserveInventory`/`releaseInventory`
   already established in Phase 5. **Regression test**: scenario 6 now
   passes deterministically across 5 consecutive runs.

3. **IDOR ordering bug in `updateCartItemQuantity`/`removeCartItem`**
   (`cart/use-cases/`). Both checked "does the caller have an active
   cart" before resolving the target item, so a caller with no cart at
   all received a generic `404` for every item id — including one that
   genuinely exists but belongs to someone else, masking the required
   `403` distinction. **Found by** the cart-authorization integration
   tests (written against the established `NotFoundError`-for-nonexistent
   /`ForbiddenError`-for-not-yours convention). **Fixed** by resolving
   the item first, the caller's own cart second, in both use-cases.
   **Regression test**: `cart-authorization.test.ts`'s three ownership
   scenarios all pass.

4. **Checkout error-ordering bug in `completeCheckout`** (mirroring bug
   #3's shape). The guest-email requirement was checked before cart
   existence, so a guest with no cart at all got a misleading `400`
   ("email required") instead of `404` ("cart not found"). **Fixed** by
   checking cart existence first.

No bug required any schema change, any transaction-boundary redesign, or
any weakening of a test to pass — every fix tightened correctness.

---

## 18. Deviations from approved plan

Both disclosed explicitly, neither expands scope, neither required a
STOP (per §1's "genuine contradiction" bar — these are narrow,
resolvable implementation-level corrections, not architectural
conflicts):

1. **Guest-cart merge triggers only from `login`, not from `register`**
   (plan §6 said "login.ts and register.ts gain one new call each").
   `register()` never auto-logs-in and deliberately returns an identical
   response regardless of whether the email already existed — an
   established, documented Phase 3 enumeration-safety invariant.
   Triggering a merge (and therefore conditionally clearing the guest
   cookie / running extra queries) only on the *new-account* branch would
   reintroduce exactly the observable `Set-Cookie`-presence side channel
   Phase 3's own review already found and fixed for session cookies.
   Every guest checkout flow is still covered: `register()` never
   auto-logs-in, so the customer always calls `login()` next, at which
   point the merge runs. No functionality is lost; enumeration-safety is
   preserved.

2. **Checkout's totals arithmetic is inlined in `checkout/repo.ts`
   rather than imported from `order/domain/order-totals.ts`** (plan §16's
   pseudocode reads "compute totals server-side (reusing
   order/domain/order-totals.ts verbatim — no duplicate totals logic)").
   The ESLint `boundaries/dependencies` rule forbids any `repo.ts` from
   importing a `domain` module — the exact rule that already keeps
   `order/repo.ts` itself from importing its own `order-totals.ts` (that
   computation lives in `order/use-cases/create-order.ts` instead).
   Checkout's totals must be computed from cart items only knowable
   *after* the cart lock, inside `checkout/repo.ts`'s own transaction —
   there is no way to hoist that computation into a use-case without
   either passing `tx` into a use-case (a hard rule violation) or
   splitting the transaction (breaking atomicity). The formula itself is
   reproduced verbatim (same round-half-up rule, same
   subtotal/discount/delivery/tax/total shape) — this is arithmetic
   duplication, not a design divergence, and matches the same "small
   deliberate duplication for layering reasons" precedent
   `order/quantity.ts`/`inventory/quantity.ts`/`cart/quantity.ts` already
   established for the identical class of problem.

No other deviation exists. Every other design decision in the approved
plan — guest-token mechanism, merge policy, cart-row locking, checkout
idempotency mechanism, transaction composition, payment-attempt boundary
— was implemented exactly as specified.

---

## 19. Known limitations

Unchanged from the plan's own disclosed list (plan §33) — none of these
were resolved or silently decided in this phase:

1. Guest-cart cookie TTL (30 days) is a chosen default, not a confirmed
   product requirement.
2. No `orders.cartId` FK — a lost-response checkout retry cannot
   automatically return the resulting order; the client must re-fetch via
   Order's existing read use-cases. Correctness (no duplicate order) is
   unaffected.
3. Guest post-checkout order lookup inherits Phase 6's own already-
   disclosed limitation, unchanged.
4. No cart/guest abandonment automation — no job-runner infrastructure
   exists in this codebase.
5. Partial-merge reporting (which guest items were dropped) is not
   surfaced to the client in any structured way.
6. The merge-quantity-addition policy (sum, not replace) is the plan's
   chosen default, not a confirmed product decision.

---

## 20. Verification results

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| `eslint .` (full project, incl. boundary rules) | ✅ 0 errors, 0 warnings |
| `prettier --check .` | ✅ all files formatted |
| Unit tests (full suite) | ✅ 130/130 |
| Integration tests (full suite, real MySQL) | ✅ 230/230 (28 files) |
| Concurrency suite, run 5× consecutively | ✅ 8/8 every run, zero flaky failures |
| E2E suite (full, real HTTP, no browser) | ✅ 27/27 |
| Production build (`next build`, raw output) | ✅ exit 0; every new route listed `ƒ` (dynamic), matching every other cookie-reading route already in the app |
| Security source scan | ✅ all checks pass (§14) |
| Database cleanliness (direct queries, not framework-reported) | ✅ zero leftover test carts/items/products/users of any kind |

---

## 21. Database cleanliness

Verified by direct Prisma queries against the real database after the
full suite ran (not inferred from test-framework "afterAll ran"
reporting):

```json
{
  "cartsWithPhase7E2EItems": 0,
  "leftoverPhase4TestProducts": 0,
  "leftoverPhase7E2EProducts": 0,
  "leftoverPhase3TestUsers": 0,
  "leftoverPhase7E2EUsers": 0,
  "totalCartsInDb": 0,
  "totalCartItemsInDb": 0,
  "totalOrdersInDb": 0,
  "totalPaymentAttemptsInDb": 0
}
```

`tests/integration/helpers/cart-fixtures.ts`'s `cleanupCartTestData()`
and `tests/e2e/global-teardown.ts`'s new Phase7E2E block both run before
their respective catalog/user cleanup (required — `carts.userId` is `ON
DELETE RESTRICT`).

---

## 22. Explicit Phase 7 status

**Cart + Checkout domain implementation is complete, fully tested, and
verified against every requirement in the approved plan.** No schema
change. No scope expansion. No Paystack, webhook, refund, payment-retry,
storefront UI, or admin dashboard code exists anywhere in this phase.

Phase 8 (Payment/Paystack integration) has **not** begun and will not
begin without explicit approval.

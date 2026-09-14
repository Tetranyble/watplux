# Phase 5 — Inventory Domain Implementation Report

## 1. Scope delivered

Everything in `docs/PHASE_5_INVENTORY_PLAN.md` (approved), plus one
explicitly-requested addition made during implementation kickoff: the
order-item/variant mismatch guard (§6 below). Delivered:

- `src/modules/inventory/` — full module (types, constants, quantity
  helpers, movement-semantics table, Zod schemas, repo, 10 use-cases).
- 6 admin API routes, exactly as specified in the plan's §23 — no more,
  no fewer.
- No schema/migration change. `prisma/schema.prisma` is untouched by this
  phase — confirmed below (§2).
- Unit tests, integration tests (including the 3 mandatory mismatch
  cases), 7 mandatory concurrency scenarios (run 6× consecutively with
  zero flaky failures), authorization matrix tests, and e2e HTTP-boundary
  tests.
- Two real, non-obvious bugs found and fixed during test-writing (§8) —
  not application-logic bugs discovered by inspection, but genuine
  concurrency defects only visible under real overlapping transactions
  against real MySQL.

Not built, per the plan's explicit hard stop: Orders, Checkout, Paystack,
webhooks, Cart, storefront UI, an inventory dashboard, Redis,
Elasticsearch, notifications.

## 2. Database change statement

**No migration was created or modified in this phase.** `prisma/schema.prisma`,
`prisma/migrations/`, and the migration history are byte-for-byte
unchanged from Phase 4. Every requirement in this phase — including the
order-item/variant mismatch guard — was satisfiable using the existing
`inventory_items` / `inventory_movements` schema and the existing FK on
`inventory_movements.order_item_id`. No schema deficiency was found.

## 3. Files created / modified

### New — inventory module (`src/modules/inventory/`)

```
types.ts                              InventoryBalance/InventoryMovementRecord DTOs, CursorPage<T>, mappers
constants.ts                          Movement types, reference types, permission keys, pagination defaults
quantity.ts                           Pure Decimal helpers (precision/sign/finiteness, adjustment-delta computation)
domain/movement-semantics.ts          Pure sign table for the 5 magnitude-based movement types
schema.ts                             Zod input schemas for every use-case
repo.ts                               The only file importing Prisma; all locking/guarding lives here
use-cases/get-inventory-for-variant.ts
use-cases/list-inventory.ts
use-cases/get-inventory-movement-history.ts
use-cases/get-available-quantity.ts
use-cases/restock-inventory.ts
use-cases/adjust-inventory.ts
use-cases/record-inventory-return.ts
use-cases/reserve-inventory.ts        Inter-module contract, no actor
use-cases/release-inventory.ts        Inter-module contract, no actor
use-cases/complete-inventory-sale.ts  Inter-module contract, no actor
```

### New — presentation layer

```
app/api/admin/inventory/route.ts
app/api/admin/inventory/[variantId]/route.ts
app/api/admin/inventory/[variantId]/movements/route.ts
app/api/admin/inventory/[variantId]/restock/route.ts
app/api/admin/inventory/[variantId]/adjust/route.ts
app/api/admin/inventory/[variantId]/return/route.ts
```

### New — tests

```
tests/unit/inventory-quantity.test.ts
tests/unit/inventory-movement-semantics.test.ts
tests/integration/helpers/inventory-fixtures.ts
tests/integration/inventory-management.test.ts       (12 tests)
tests/integration/inventory-reservation.test.ts       (13 tests, incl. the 3 mandatory mismatch cases)
tests/integration/inventory-concurrency.test.ts       (7 tests, the 7 mandatory scenarios)
tests/integration/inventory-authorization.test.ts     (6 tests)
tests/e2e/inventory.spec.ts                           (4 tests)
```

### Modified — shared infrastructure

```
tests/e2e/global-teardown.ts   Extended with Phase 5's e2e test-data cleanup
```

No other file outside `src/modules/inventory/`, the 6 new routes, and the
test files above was modified.

## 4. Architecture

Presentation (Route Handlers) → use-case → `repo.ts` → Prisma → MySQL,
identical shape to catalog. `repo.ts` is the only file in the module that
imports `@/lib/db` — verified by source scan (§9). `domain/movement-semantics.ts`
is pure (no Prisma import except the `Prisma.Decimal` value, the same
precedent Phase 4 set for importing Prisma *types* into `types.ts`) and
is called only by tests and (conceptually) by use-cases wanting the sign
table — `repo.ts` itself hardcodes the sign pattern per movement type
inline, since it never needed the abstraction.

`quantity.ts` was deliberately placed at the module root, not under
`domain/`, from the start — mirroring the lesson Phase 4 learned the hard
way (its `slug.ts`/`default-variant.ts` had to be relocated out of
`domain/` mid-phase, because `repo.ts` cannot import `domain/` per the
ESLint boundary rules, but needs to call these pure helpers from inside
guarded transactions).

### A cross-module design decision: `audit_logs` writes

The plan didn't specify exactly how `RESTOCK`/`ADJUSTMENT` audit entries
should be written. The obvious-looking option — importing
`authRepo.writeAuditLog` from `src/modules/auth/repo.ts` — was rejected
during implementation: it would be a new, unprecedented repo-to-repo
cross-module import (grep-confirmed the catalog module never did this in
Phase 4). Instead, `repo.ts` writes directly to `audit_logs` via a
private `insertAuditLog(tx, data)` helper, since `audit_logs` is generic,
system-wide infrastructure (`docs/DATABASE_DESIGN.md` §15), not
auth-owned. This runs inside the SAME transaction as the movement insert
— strictly stronger than Phase 3's own pattern, which wrote its audit log
as a separate, non-transactional call after the main write.

## 5. Movement semantics, quantities, and locking (as actually implemented)

Exactly six movement types (`RESTOCK`, `RESERVE`, `RELEASE`, `SALE`,
`RETURN`, `ADJUSTMENT`), matching the schema's `InventoryMovementType`
enum verbatim — no renaming, no `RECEIPT`, no `CANCELLATION`. All
quantities are `Prisma.Decimal`; arithmetic uses decimal.js exclusively
(`quantity.ts`'s `computeAdjustmentDelta`, verified by a regression test
proving `0.3 - 0.1 = 0.2` exactly, not the JS float artifact).

- **RESTOCK / RETURN**: blind guarded increment (no guard needed —
  increasing on-hand can never violate an invariant).
- **RESERVE / RELEASE / SALE**: the atomic guarded `UPDATE ... WHERE`
  compare-and-swap pattern (`updateMany`, checking `result.count === 0`
  for guard failure) — never `SELECT ... FOR UPDATE`, per the plan's
  explicit prohibition. RESERVE guards `quantityAvailable >= requested`;
  RELEASE/SALE guard `quantityReserved >= requested`.
- **ADJUSTMENT (delta)**: blind guarded relative update, symmetric guard
  covering both "would go negative" and "would leave reserved > on-hand".
- **ADJUSTMENT (absolute target)**: the one operation needing
  `SELECT ... FOR UPDATE` — the delta must be computed from a value read
  under lock. The lock is the transaction's first statement (see §7 for
  the hardening this required).

Idempotency: the existing `order_item_movement_dedup_key` generated
column is the only dedup mechanism — no new table. See §7 for how the
recovery path actually had to work, which differs from the plan's
original one-line description in a materially important way.

## 6. The order-item/variant mismatch guard (explicitly requested during kickoff)

This was not part of the originally approved plan — it was an explicit,
critical correction given at the start of implementation, and is
disclosed here as such, not presented as a self-invented addition.

**The problem**: `inventory_movements.order_item_id → order_items.id` (an
`onDelete: Restrict` FK) only proves the referenced `order_item` row
exists. It does **not** prove `order_item.product_variant_id` equals the
`product_variant_id` of the `inventory_item` being mutated.

**The fix**: `requireMatchingOrderItem(tx, orderItemId, variantId)` in
`repo.ts` — called first, inside the transaction, before any mutation —
throws `NotFoundError` if the order item doesn't exist, and
`ValidationError` if `orderItem.productVariantId === null` or doesn't
equal the target `variantId`. Applied to `reserveInventory` (which
receives an independent, caller-supplied `variantId` to cross-check).
`releaseInventory`/`completeInventorySale` derive their variant from the
order item itself (no independent second value exists to check against),
so a defensive consistency check verifies the existing `RESERVE`
movement's `inventoryItemId` matches the resolved inventory item instead
— belt-and-suspenders against the same class of bug.

**Tests** (`tests/integration/inventory-reservation.test.ts`, all
passing): a valid order-item/variant match; a nonexistent order item; and
the mandatory case — `OrderItem A → Variant A`, a separate `Inventory →
Variant B`, `RESERVE(OrderItem A, Variant B)` — confirmed to fail with
`statusCode: 400`, confirmed via direct DB re-read that **neither**
variant's inventory changed and **no** `RESERVE` movement row was ever
inserted.

## 7. Idempotency — a materially different implementation than the plan described

The plan's idempotency description ("attempt the transaction; if the
INSERT hits the dedup-key violation, catch it outside the transaction and
return the existing movement") turned out to be **incomplete** once
tested under genuine concurrency. This section documents what was
actually needed, since it differs from the approved design in a way that
matters.

**The gap, found via testing, not by inspection**: for RESERVE/RELEASE/SALE,
the guarded `UPDATE`'s own `WHERE` clause checks the exact balance field
the operation itself changes. A **sequential** retry (second call made
after the first has already committed) has its guard fail — legitimately,
by the guard's own logic — *before* the transaction ever reaches the
INSERT that the dedup-key catch relies on. For RELEASE/SALE this guard
failure is not a boundary case, it is **unconditional**: the first call's
own effect always drives the guarded field to exactly the point where a
second, identical guard evaluation fails.

**Fix, layer 1 (sequential case)**: a fast-path existence check —
`db.inventoryMovement.findFirst({ orderItemId, type })` — runs *before*
opening the transaction at all, in all three functions. If a movement of
that type already exists, it's returned immediately.

**Fix, layer 2 (genuinely concurrent case)**: layer 1 alone is
insufficient — two truly concurrent calls can both pass the fast-path
check (seeing nothing yet) before either commits, then race on the
guarded `UPDATE`'s row lock. The loser's guard, evaluated against the
winner's now-committed state, fails the *exact same way* the sequential
case did — but this happens *inside* the transaction, after its own guard
failure, not before opening it. The fix: on guard failure
(`result.count === 0`), re-check for an existing movement of that type
before throwing. If found, return it as the idempotent result instead of
a hard error.

**A second, more subtle bug found while building fix layer 2**: the
first attempt at this re-check used `tx.inventoryMovement.findFirst(...)`
— a *plain* read inside the same transaction. This transaction had
already performed other plain reads earlier (resolving `orderItem`,
`inventoryItem`) *before* the sibling transaction could possibly have
committed, which — under MySQL's REPEATABLE READ — fixes this
transaction's consistent-read snapshot at that earlier point. The
guard-failure re-check, run later in the *same* transaction, is
therefore invisible to the sibling's already-committed INSERT: it reads
the pre-sibling-commit snapshot, finds nothing, and the caller gets a
spurious error instead of the idempotent result. This is the same
snapshot-poisoning failure class the user's kickoff message warned about
citing Phase 4's `archiveVariant`/`setDefaultVariant` bug, and it
reappeared here in a new shape. **Fix**: the guard-failure re-check reads
via `db.` (a fresh, separate connection), not `tx.` — bypassing the
poisoned snapshot entirely, since the sibling transaction has, by
construction, already fully committed by the time this guard evaluates
against latest data.

This was empirically verified, not just reasoned about: concurrency
scenario 3/7 and 4/7 (§9 below) failed reproducibly before this fix (1 of
2 concurrent calls rejected with a raw `ValidationError`) and passed
consistently afterward, across 6 consecutive full-suite runs.

## 8. `adjustInventoryByDelta`/`adjustInventoryToTarget` — a documentation/code mismatch, investigated and closed (not a functional bug)

`adjustInventoryToTarget`'s original comment claimed "the `SELECT ... FOR
UPDATE` is unconditionally the transaction's first statement — no plain
read precedes it." The code did not actually match this: both adjustment
functions opened their transaction with a plain `tx.inventoryItem.findUnique`
to resolve the row's immutable `id`, *before* the lock/guard.

Investigation (empirical: 8 consecutive runs of a dedicated concurrency
probe; and theoretical: MySQL's documented behavior that `UPDATE ... WHERE`
always evaluates against latest committed data and takes a lock,
regardless of the transaction's REPEATABLE READ snapshot) confirmed this
was **not** an exploitable bug: the guarded `UPDATE` in each function
always operates on latest committed data (bypassing any snapshot), and
the subsequent "refreshed" invariant check benefits from "a transaction
always reads back its own writes" — since the guarded `UPDATE` itself
constructs its new row version from the latest committed data for *all*
columns (not just the ones in its `SET` clause), the later plain read
correctly reflects concurrent activity. Scenario 2/7 (reservation racing
an adjustment) confirmed this empirically: 8/8 clean runs, zero invariant
violations, even before any change was made.

**Action taken anyway**: both functions were tightened to move the
immutable `id`-resolution read to `db.` (outside the transaction),
matching Phase 4's own established fix for exactly this class of lookup,
and making the transaction's first statement literally match what its
own comment already claimed. This removes any future reliance on the
subtler "a write refreshes the whole row" mechanic, which is correct
today but would be fragile to preserve under later refactors (e.g., if
someone removed the guarded `UPDATE` while leaving the plain read). This
is disclosed as a proactive hardening, not a functional bug fix — the
old code was not wrong, it was just harder to verify as correct by
inspection.

## 9. A real bug found and fixed: `listInventoryItems`'s `lowStockOnly` raw-SQL path

`repo.ts`'s `$queryRaw` path for `lowStockOnly` (needed because Prisma's
type-safe builder cannot express the column-vs-column comparison
`quantity_available <= low_stock_threshold`) originally did `SELECT * FROM
inventory_items ...`. Prisma's raw-query driver returns exactly the
column names as written in the query — MySQL's actual snake_case column
names (`product_variant_id`, `quantity_on_hand`, ...) — not Prisma's
camelCase model field names. Every caller of `listInventoryItems`
(`toInventoryBalance`) expected camelCase fields and crashed with
`Cannot read properties of undefined (reading 'toString')` the first
time a real row went through this path in an integration test.

**Fix**: explicit column aliases (`product_variant_id AS
productVariantId`, etc.) in the raw query. Verified empirically (a
throwaway script against the real dev database, cleaned up after) that
value *types* were already correct — `Prisma.Decimal` for `DECIMAL`
columns, `BigInt` for `UnsignedBigInt`, `Date` for `DATETIME` — only the
key *names* needed fixing.

## 10. Authorization

`inventory.read` for all reads; `inventory.adjust` for RESTOCK/ADJUSTMENT/RETURN.
No new permissions invented — confirmed no `inventory.reserve`/
`inventory.release`/`inventory.sale` exists anywhere in the codebase
(grep-verified). Per `prisma/seed-data.ts`: `staff` has `inventory.read`
only; `super_admin` has both; `customer` has neither. All checks go
through `requirePermission(actor, PERMISSION_X)` — never a role name.
`reserveInventory`/`releaseInventory`/`completeInventorySale` take no
`actor` at all (inter-module contracts, not user-facing operations).

## 11. Order/Payment module boundaries

Confirmed by source scan (§12): the inventory module never imports from
or references `payment_attempt_id`, never calls Paystack, never inspects
a payment attempt, exposes no HTTP route for RESERVE/RELEASE/SALE, and
never writes to `orders.status` or `order_status_history`. Inventory owns
inventory state only. The three inter-module contract functions accept a
bare `orderItemId`/`variantId`/`quantity` — nothing else.

## 12. Security source scan

- Every `$queryRaw`/`tx.$queryRaw` usage is a tagged template literal
  (Prisma-parameterized) — grep confirmed zero uses of
  `$queryRawUnsafe`/`$executeRawUnsafe` and zero string-concatenated SQL
  anywhere in the module.
- All 6 API routes call `requireSessionUser()` before doing anything else
  — grep confirmed no route file is missing it.
- No secrets, passwords, or API keys referenced anywhere in the module.
- No `console.log` anywhere in the module (structured logging isn't used
  here either — matches Phase 4's precedent of no ad-hoc logging in
  business logic).
- Only `repo.ts` imports `@/lib/db` within `src/modules/inventory/` —
  confirmed by grep, preserving the "only repo.ts touches Prisma"
  boundary.
- ESLint's `boundaries/dependencies` rule re-tested live: a deliberate
  `import * as inventoryRepo from "@/src/modules/inventory/repo"` added
  to `app/api/admin/inventory/route.ts` correctly produced the
  `boundaries/dependencies` error ("Presentation (app/**) must go through
  a use-case..."); reverted immediately after confirming, re-verified
  clean.
- The e2e suite's forged-field test (`tests/e2e/inventory.spec.ts`)
  confirms a request body's `actorPermissions`/`isAdmin` fields have zero
  effect over real HTTP — the actor is always resolved server-side from
  the session cookie.

## 13. Tests

| Suite | File(s) | Count |
|---|---|---|
| Unit | `tests/unit/inventory-quantity.test.ts` | 14 |
| Unit | `tests/unit/inventory-movement-semantics.test.ts` | 7 |
| Integration — management | `tests/integration/inventory-management.test.ts` | 12 |
| Integration — reservation (incl. 3 mandatory mismatch cases) | `tests/integration/inventory-reservation.test.ts` | 13 |
| Integration — concurrency (7 mandatory scenarios) | `tests/integration/inventory-concurrency.test.ts` | 7 |
| Integration — authorization | `tests/integration/inventory-authorization.test.ts` | 6 |
| E2E | `tests/e2e/inventory.spec.ts` | 4 |

Full repo-wide integration suite (all modules, 17 files): **142 passed,
0 failed**. Full repo-wide e2e suite (5 files): **17 passed, 0 failed**.
Full repo-wide unit suite (9 files): **73 passed, 0 failed**.

## 14. Concurrency verification (the 7 mandatory scenarios)

Each test inspects the final database row state directly via a fresh
`db.inventoryItem.findUniqueOrThrow`/`db.inventoryMovement` query — never
inferred from which `Promise.allSettled` result fulfilled or rejected.

1. **Two reservations competing for the last available unit** — exactly
   one fulfills, exactly one rejects, final `quantityReserved = 1`,
   `quantityAvailable = 0`, exactly one `RESERVE` movement row.
2. **Reservation racing an adjustment** — final state never has
   `quantityReserved > quantityOnHand` (see §8 for the investigation this
   scenario triggered).
3. **Concurrent RELEASE** (same order item, two truly concurrent calls) —
   both calls resolve (idempotent), same movement `id`, exactly one
   `RELEASE` row, reserved correctly returns to 0.
4. **Concurrent SALE** — same shape as #3, `quantityOnHand` decremented
   exactly once.
5. **Duplicate SALE** (sequential — first call fully committed before the
   second starts) — second call returns the identical movement, not a
   hard error; exactly one `SALE` row.
6. **Retry after a simulated transaction failure** (dedup-key collision
   under genuine concurrency) — both calls resolve to the same movement;
   critically, `quantityReserved` is exactly 5, not 10 — proving the
   losing transaction's guarded `UPDATE` was fully rolled back, not
   partially applied.
7. **Concurrent absolute-target adjustments** — both succeed (serialized
   by the `SELECT ... FOR UPDATE` lock); final `quantityOnHand` is
   deterministically one of the two targets, never a corrupted
   intermediate value; the sum of both movements' `onHandDelta` exactly
   accounts for the total change.

**Run 6 times consecutively** (exceeding the mandatory 5×): zero flaky
failures across all 6 runs, 7/7 passing every time.

## 15. Known limitations

- `getAvailableQuantity` is unauthenticated by design (per the plan) —
  it exposes only `quantityAvailable`, never `quantityOnHand`/
  `quantityReserved`. No storefront consumes it yet (Phase 5 has no UI).
- The `reserveInventory`/`releaseInventory`/`completeInventorySale`
  inter-module contracts are exercised only by direct calls from tests in
  this phase — there is no Order module yet to call them for real. The
  Order/OrderItem rows used in tests are created directly via Prisma
  (`tests/integration/helpers/inventory-fixtures.ts`), matching the
  actual `orders`/`order_items` schema exactly.
- `getInventoryMovementHistory`'s keyset pagination has not been tested
  at high volume (thousands of movements) — correctness was verified
  functionally (ordering, cursor advancement, no duplicate/skipped rows
  across a page boundary), not under load.
- No caching layer — every read goes straight to MySQL, matching the
  plan's explicit "no Redis" constraint for this phase.

## 16. Deviations from the approved plan (complete list, nothing omitted)

1. **The order-item/variant mismatch guard (§6)** — explicitly requested
   by the user during implementation kickoff, not part of the originally
   approved `docs/PHASE_5_INVENTORY_PLAN.md`, not self-invented. Required
   no schema change; implemented entirely inside `repo.ts`.
2. **The idempotency mechanism is more involved than the plan described
   (§7)** — the plan's one-line description ("catch the dedup violation,
   return the existing movement") was correct for the concurrent-INSERT
   race it was written for, but incomplete for the guard-failure-before-INSERT
   case that sequential and some concurrent retries actually hit. Two
   additional layers were added (fast-path pre-check; guard-failure
   re-check reading via `db.` not `tx.`) to make RESERVE/RELEASE/SALE
   genuinely idempotent in every case tested.
3. **`adjustInventoryByDelta`/`adjustInventoryToTarget` hardened (§8)** —
   not a functional bug (verified empirically and theoretically), but the
   code was tightened to literally match its own documented contract
   ("no plain read precedes the lock"), removing reliance on a subtler
   correctness argument.
4. **`listInventoryItems`'s raw-SQL bug (§9)** — a genuine bug (missing
   column aliases), found and fixed during integration testing, before
   any user-facing exposure.
5. **`audit_logs` writes go directly through this module's own `repo.ts`**,
   not through `authRepo` — a deliberate architecture decision (§4), not
   a bug, made to avoid introducing a new cross-module repo-to-repo
   coupling with no precedent in the codebase.

No deviation was hidden, and none required a schema or migration change.

## 17. Final verification matrix

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| ESLint (full repo) | Clean |
| Prettier `--check` (full repo) | Clean |
| Unit tests | 73/73 passed |
| Integration tests (full repo, 17 files) | 142/142 passed |
| Concurrency tests (7 scenarios × 6 consecutive runs) | 42/42 passed, zero flakiness |
| E2E tests (full repo, 5 files) | 17/17 passed |
| Production build (`next build`, raw/unfiltered) | Exit 0, all inventory routes correctly listed as dynamic (`ƒ`) |
| ESLint architectural-boundary re-test | Fired correctly on a deliberate violation; reverted; re-confirmed clean |
| Security source scan | Clean — no unparameterized SQL, no missing auth checks, no secrets, correct Prisma-import boundary |
| Database-cleanliness check | Zero leftover rows in `inventory_items`/`inventory_movements`/test orders/test products/categories/users after every suite ran |

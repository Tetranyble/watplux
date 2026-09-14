# Phase 5 — Inventory Domain Implementation Plan

Status: **plan only — no application code written**. Grounded against the
actual current state of `prisma/schema.prisma`, `docs/DATABASE_DESIGN.md`
§5/§19/§21/§22, `docs/ARCHITECTURE.md` §7/§8, `docs/PHASE_2B_REPORT.md`
(the inventory domain's actual migrated SQL and its already-confirmed
negative tests), and the Phase 3/4 module/RBAC/testing conventions.

Unlike Phase 4's catalog domain, inventory was **already deeply designed**
in Phase 2A/2B — the ledger shape, every movement type's semantics, the
reservation compare-and-swap pattern, and the exactly-once dedup key are
all pre-approved, already-migrated, and already covered by Phase 2B's
negative-test suite against the real database. This plan's job is
therefore mostly to **confirm and cite** that existing design precisely,
and to resolve the handful of genuinely new decisions Phase 5's
application layer requires (the use-case list, authorization mapping,
adjustment-delta translation, idempotent-retry behavior) — not to
redesign anything already settled.

---

## 0. What this plan resolves

1. The exact current schema shape for `inventory_items`/`inventory_movements`, cited directly, not from memory (§3).
2. Precise per-movement-type semantics, including the two types the illustrative brief didn't name (`RESTOCK` not `RECEIPT`, plus `RETURN`) (§4).
3. How `quantity_available` is fed by the ledger and which values are authoritative (§5).
4. The exact transaction/locking mechanism for reservation, release, and sale — already specified in `docs/DATABASE_DESIGN.md` §5/§21/§22 as an atomic conditional `UPDATE`, deliberately **not** the `SELECT ... FOR UPDATE` pattern Phase 4 used for the catalog's default-variant invariant (§6/§7).
5. The one inventory operation that genuinely does need an explicit row lock — absolute-quantity adjustment — and why it's different from reservation (§7, §12).
6. The use-case inventory and its authorization mapping against Phase 3's **already-seeded** `inventory.read`/`inventory.adjust` permissions — no new permission keys are needed (§9, §10).
7. The inventory ↔ future-Order/Payment contract shape (§15/§16).

Everything else below is direct implementation of decisions already made
in Phase 2A/2B — this plan does not revisit or reopen those.

---

## 1. Existing schema analysis (read directly from `prisma/schema.prisma` and confirmed against `docs/PHASE_2B_REPORT.md`'s live-database verification)

### `inventory_items`

```prisma
model InventoryItem {
  id                BigInt   @id @default(autoincrement()) @db.UnsignedBigInt
  productVariantId  BigInt   @unique @map("product_variant_id") @db.UnsignedBigInt
  quantityOnHand    Decimal  @default(0) @map("quantity_on_hand") @db.Decimal(12, 3)
  quantityReserved  Decimal  @default(0) @map("quantity_reserved") @db.Decimal(12, 3)
  quantityAvailable Decimal? @map("quantity_available") @db.Decimal(12, 3)   // GENERATED, see §5
  lowStockThreshold Decimal? @map("low_stock_threshold") @db.Decimal(12, 3)
  updatedAt         DateTime @updatedAt @map("updated_at")

  productVariant ProductVariant      @relation(fields: [productVariantId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  movements      InventoryMovement[]
}
```

- **1:1 with `product_variants`** (`@unique` on `productVariantId`) — confirmed: `ProductVariant.inventoryItem` is `InventoryItem?` (**optional**, not `InventoryItem`). A variant can exist with **no** `InventoryItem` row at all — this is a real state (a newly created variant has no stock tracked yet), not an error condition, and Phase 5's use-cases must handle it explicitly (§9, §11).
- `onDelete: Restrict, onUpdate: Restrict` — a variant can never be deleted while it has an inventory row (consistent with Phase 4's confirmation that variants are archived, never deleted, once stocked).
- Three `CHECK` constraints, already migrated and already confirmed rejecting bad writes in Phase 2B's negative-test pass (`docs/PHASE_2B_REPORT.md` §F):
  ```sql
  chk_inventory_items_on_hand_nonneg:      quantity_on_hand >= 0
  chk_inventory_items_reserved_nonneg:     quantity_reserved >= 0
  chk_inventory_items_reserved_le_on_hand: quantity_reserved <= quantity_on_hand
  ```

### `inventory_movements`

```prisma
enum InventoryMovementType { RESTOCK RESERVE RELEASE SALE RETURN ADJUSTMENT }
enum InventoryMovementReferenceType { MANUAL PURCHASE_ORDER }

model InventoryMovement {
  id                        BigInt                          @id @default(autoincrement()) @db.UnsignedBigInt
  inventoryItemId           BigInt                          @map("inventory_item_id") @db.UnsignedBigInt
  type                      InventoryMovementType
  onHandDelta               Decimal                         @default(0) @map("on_hand_delta") @db.Decimal(12, 3)
  reservedDelta             Decimal                         @default(0) @map("reserved_delta") @db.Decimal(12, 3)
  orderItemId               BigInt?                         @map("order_item_id") @db.UnsignedBigInt
  referenceType             InventoryMovementReferenceType? @map("reference_type")
  referenceId               BigInt?                         @map("reference_id") @db.UnsignedBigInt
  note                      String?                         @db.Text
  createdBy                 BigInt?                         @map("created_by") @db.UnsignedBigInt
  createdAt                 DateTime                        @default(now()) @map("created_at")
  orderItemMovementDedupKey String? @unique @map("order_item_movement_dedup_key") @db.VarChar(80)   // GENERATED, see below

  inventoryItem InventoryItem @relation(fields: [inventoryItemId], references: [id], onDelete: Restrict)
  createdByUser User?         @relation(fields: [createdBy], references: [id], onDelete: SetNull)
  orderItem     OrderItem?    @relation(fields: [orderItemId], references: [id], onDelete: Restrict, onUpdate: Restrict)
}
```

**Corrected against the brief's illustrative movement-type list**: the
approved, already-migrated enum is exactly `RESTOCK | RESERVE | RELEASE |
SALE | RETURN | ADJUSTMENT` — six types, not the brief's five, and the
receiving-stock type is named **`RESTOCK`**, not `RECEIPT`. `CANCELLATION`
was considered in an earlier draft and explicitly removed
(`docs/DATABASE_DESIGN.md` §5) for never having a meaning distinct from
`RELEASE`. This plan uses the real enum throughout; §11's "stock receipt"
request is answered by `RESTOCK`.

Append-only: no `updatedAt`, confirmed no use-case anywhere may `UPDATE`
or `DELETE` a row in this table once inserted.

**Generated column — the exactly-once guarantee**, already migrated and
already confirmed rejecting duplicates in Phase 2B (`docs/PHASE_2B_REPORT.md`
§F: "Duplicate SALE/RELEASE/RESERVE for one order item" all confirmed
rejected against the real database):

```sql
order_item_movement_dedup_key VARCHAR(80)
  GENERATED ALWAYS AS (
    CASE WHEN type IN ('RESERVE', 'RELEASE', 'SALE')
         THEN CONCAT(type, '-', order_item_id)
         ELSE NULL END
  ) STORED,
UNIQUE KEY uq_one_reserve_release_sale_per_order_item (order_item_movement_dedup_key)
```

This guarantees **at most one `RESERVE`, at most one `RELEASE`, and at
most one `SALE` per `order_item_id`** — three independent one-per-line
guarantees expressed by one column, not "at most one movement total" per
order item (a `RESERVE` and a later `SALE` for the *same* order item both
exist legitimately; it's a second `RESERVE`, second `RELEASE`, or second
`SALE` for that same order item that's rejected).

**A fourth already-migrated `CHECK`, load-bearing for §4's per-type rules**
(confirmed present and confirmed rejecting bad rows in Phase 2B's negative
tests — `docs/PHASE_2B_REPORT.md` §D.3/§F):

```sql
chk_inventory_movements_order_item_required:
  type NOT IN ('RESERVE', 'RELEASE', 'SALE') OR order_item_id IS NOT NULL
```

`order_item_id` is nullable at the column-type level (to accommodate
`RESTOCK`/`ADJUSTMENT`, which never reference one), but this `CHECK`
makes it **effectively `NOT NULL` for `RESERVE`/`RELEASE`/`SALE`
specifically** — a real database constraint, not just an application
convention this plan is choosing to follow.

### The relationships the plan must not redesign

```
product_variant (1) ──── (0 or 1) inventory_item ──── (0..N) inventory_movements
                                                              │
order_item (0 or 1) ─────────────────────────────────────────┘
   (nullable FK, ON DELETE RESTRICT — populated for RESERVE/RELEASE/SALE
    always, RETURN when order-linked, NULL for RESTOCK/ADJUSTMENT)
```

`inventory_movements.order_item_id → order_items.id` was a genuine forward
reference during the Inventory migration (Migration 3, before `order_items`
existed) and had its real FK added via `ALTER TABLE` once `order_items`
was created in the Commerce migration (Migration 4) —
`docs/PHASE_2B_REPORT.md` §D.4. This is already fully resolved,
already-applied schema; Phase 5 reads it as a given, closed fact.

---

## 2. Inventory architecture

Confirmed and preserved exactly: **inventory is an append-only movement
ledger, not a mutable balance table with incidental history.**
`inventory_items` holds only the two independently-writable numbers
(`quantity_on_hand`, `quantity_reserved`) plus the derived
`quantity_available` (§5) — every change to either writable number
happens **only** as a side effect of inserting an `inventory_movements`
row inside the same transaction (`docs/ARCHITECTURE.md` §7: *"never a bare
`UPDATE inventory_items SET quantity...` from application code"*). No
second inventory table, no `stock`/`inventory_balance`/`product_stock`/
`variant_stock` table, no cache-as-source-of-truth is introduced by this
plan — the existing two tables are sufficient and were explicitly designed
to be.

---

## 3. Movement semantics — every type, precisely

| Type | Direction | `on_hand_delta` | `reserved_delta` | `order_item_id` | `reference_type`/`reference_id` | Reversible? | Who creates it | Idempotent via |
|---|---|---|---|---|---|---|---|---|
| `RESTOCK` | on-hand increases | `+qty` | `0` | never (`NULL`) | `PURCHASE_ORDER` (+ `reference_id`) if there's a formal PO record, else `MANUAL`/`NULL` | Not itself — a mis-entered restock is corrected with an `ADJUSTMENT`, never edited/deleted | Staff/admin holding `inventory.adjust` | No exactly-once constraint (repeats are legitimate — the same variant is restocked repeatedly over time); duplicate-submission protection is a use-case-level concern (§14), not a schema one |
| `RESERVE` | reserved increases | `0` | `+qty` | **always**, `CHECK`-enforced | `NULL` | Reversed by exactly one `RELEASE` (not itself edited) | The (future) checkout use-case, inside the order-creation transaction — no direct human actor; `created_by` is `NULL` | The dedup-key unique index — at most one `RESERVE` per `order_item_id`, ever |
| `RELEASE` | reserved decreases | `0` | `-qty` | **always**, `CHECK`-enforced | `NULL` | Terminal — undoes the one `RESERVE` for this line | The (future) cancellation/TTL-sweep use-case or admin cancel action; `created_by` is `NULL` for system-driven, set for an explicit admin cancel | The dedup-key unique index — at most one `RELEASE` per `order_item_id`, ever |
| `SALE` | on-hand **and** reserved both decrease together | `-qty` | `-qty` | **always**, `CHECK`-enforced | `NULL` | Terminal — the reservation's life ends here, converted to an actual deduction | The (future) async payment-webhook worker, gated by the order's `PENDING_PAYMENT → PAID` conditional `UPDATE` (`docs/ARCHITECTURE.md` §7); `created_by` is `NULL` (system) | The dedup-key unique index — at most one `SALE` per `order_item_id`, ever, **and** the caller's own conditional order-status `UPDATE` (§16) — two independent guards |
| `RETURN` | on-hand increases | `+qty` | `0` | **may** be set (a documented customer return against a specific line) or `NULL` (an undocumented/bulk warehouse correction) | Typically `NULL` — a return is about a specific order line, not a PO | Not itself — a wrong `RETURN` entry is corrected with an `ADJUSTMENT` | Staff/admin holding `inventory.adjust` | **No** exactly-once constraint (the dedup key deliberately excludes `RETURN` — `docs/DATABASE_DESIGN.md` §5: multiple partial returns against the same line are legitimate) |
| `ADJUSTMENT` | on-hand changes by a signed delta (either direction) | `±qty` | `0` | never (`NULL`) | Not meaningful for a pure correction — left `NULL` in the common case; nothing prevents `MANUAL` if a future admin UI wants a reference row, but none is required | Not itself — a wrong adjustment is corrected with a further, separately-audited `ADJUSTMENT` | Staff/admin holding `inventory.adjust`, `note` **mandatory** (app-enforced — `docs/DATABASE_DESIGN.md` §5 invariant 9) | No exactly-once constraint; duplicate-submission protection is a use-case-level concern (§14) |

**Whether a movement can occur before/after payment**: only `RESERVE`
(before payment, at order creation) and `SALE` (exactly at the
`PENDING_PAYMENT → PAID` transition) are payment-lifecycle-bound at all.
`RESTOCK`, `ADJUSTMENT`, and `RETURN` are entirely independent of any
order/payment state — they're warehouse-side facts. `RELEASE` occurs when
an order is abandoned/cancelled **before** a successful payment (an order
that has already reached `PAID` is never released; per
`docs/ARCHITECTURE.md` §8, a post-payment refund produces no automatic
inventory movement at all — restocking a returned physical item is a
manual `RETURN`/`ADJUSTMENT`, entered once the item is physically back).

**Transaction boundary for every type**: the `inventory_items` balance
update and its corresponding `inventory_movements` insert are always
**one transaction** — never two separate statements/calls, regardless of
type. Exact statement ordering and locking mechanism per type is §7's
subject, not repeated here.

---

## 4. Quantity model — `DECIMAL(12,3)`, never JavaScript floats

Preserved exactly as designed (`docs/DATABASE_DESIGN.md` §19): every
quantity-shaped column (`quantity_on_hand`, `quantity_reserved`,
`on_hand_delta`, `reserved_delta`) is `DECIMAL(12,3)` — never converted to
`INT`, never computed as a JavaScript `number` and written back as an
absolute value. This is not merely a style preference; it is the specific
mechanism that makes solar cable (sold by fractional length, e.g. 2.5m)
representable at all without silent rounding.

**Concrete rules for Phase 5's use-cases:**
- **All arithmetic on these columns happens in SQL, inside the
  transaction, via Prisma's `{ increment: ... }` / `{ decrement: ... }`
  modifiers or an equivalent relative expression** — never `read value in
  JS → compute in JS → write absolute value back`, which is exactly the
  floating-point and lost-update hazard §13 of the instruction warns
  against. The one case that legitimately needs a value read in
  application code (translating an admin's *absolute* target quantity
  into a delta, §12) reads it as a Prisma `Decimal` (via `@prisma/client`'s
  `Prisma.Decimal`, backed by `decimal.js`) and performs the subtraction
  using `Decimal`'s own arithmetic methods (`.minus()`), never
  `Number(x) - Number(y)`.
- **Minimum precision, `0.001`**: validated at the Zod schema layer —
  quantities are accepted as `z.number()` (JSON has no native decimal
  type) but immediately checked with a `superRefine` that rejects any
  value whose decimal representation exceeds 3 fractional digits (e.g.
  `2.5` and `2.500` both valid; `2.5001` rejected) before it ever reaches
  a Prisma call — the same “validate the shape a caller can send, not
  just what the database happens to accept” discipline Phase 4 applied to
  money.
- **Positivity**: every quantity a use-case accepts as an input (restock
  amount, reserve amount, release amount, sale amount, return amount) must
  be a positive, non-zero `Decimal` — `ADJUSTMENT` is the sole exception,
  where the *delta* may be negative (a downward correction) but the
  resulting `quantity_on_hand` must never go negative (enforced by the
  `chk_inventory_items_on_hand_nonneg` `CHECK`, with the use-case's own
  guarded `UPDATE`, §12, as the primary defense rather than relying on the
  `CHECK` to be the first line of defense).
- **Comparison behavior**: `Decimal` equality/comparison (`.equals()`,
  `.greaterThanOrEqualTo()`, etc.) is used wherever quantities are compared
  in application code (rare — most comparisons happen in the SQL `WHERE`
  clause itself, per §7); raw `===`/`<`/`>` on `Decimal` instances is
  avoided since it coerces to string, not numeric, comparison.
- **Rounding policy**: none is applied anywhere in this domain — a
  quantity is stored exactly as submitted (up to 3 decimal places) and
  never rounded. Rounding is a concern for money display, not for a
  physical quantity ledger.

---

## 5. Inventory balance model — what's authoritative

```
quantity_on_hand    — physical units actually in the warehouse
quantity_reserved   — units currently held against an in-flight order
                       (PENDING_PAYMENT), not yet sold
quantity_available  — quantity_on_hand - quantity_reserved (GENERATED,
                       STORED — docs/DATABASE_DESIGN.md §5 invariant 2)
```

**`quantity_available` is fed entirely by the ledger, indirectly, through
the two writable columns it's computed from** — it is never itself
written to, by application code or otherwise (it's a MySQL `GENERATED
... STORED` column; Prisma's own generated client type marks it
optional/read-only for exactly this reason, confirmed already in Phase 4's
handling of the schema's other generated columns,
`product_variants.default_variant_key`). Every `inventory_movements`
insert that changes `quantity_on_hand` and/or `quantity_reserved`
automatically and atomically changes `quantity_available` as a
consequence of the same `UPDATE` — there is no separate step, and no
window where it could be stale relative to the two source columns.

**Authoritative values, precisely:**
- `quantity_on_hand` and `quantity_reserved` — authoritative, directly
  writable (only via the guarded, movement-paired `UPDATE`s in §7).
- `quantity_available` — authoritative but derived; safe to read directly
  for any "can this be sold" decision (that's precisely why it's `STORED`,
  per `docs/ARCHITECTURE.md` §7 — cheap, indexed, no per-read
  recomputation needed) — but never a *target* of a write.
- **The ledger (`inventory_movements`) is the ultimate source of truth**:
  summing `on_hand_delta` over all movements for an item must equal its
  current `quantity_on_hand`; summing `reserved_delta` must equal
  `quantity_reserved` (`docs/DATABASE_DESIGN.md` §5's "genuine, checkable
  reconciliation invariant"). Phase 5 exposes this as an internal
  consistency check (§17), not a live-served value — the two `inventory_items`
  columns remain what every real-time query reads, precisely because
  re-summing the whole ledger on every stock check would be needlessly
  expensive when the running balance is already maintained transactionally.

---

## 6. Reservation model

**Reservation ownership — preserved exactly**: a reservation belongs to
the **order**, expressed via `inventory_movements.order_item_id`, never to
a `payment_attempt`. `docs/ARCHITECTURE.md` §7's table is the authoritative
statement of this and is not restated differently here:

| Order event | Inventory action |
|---|---|
| Order created (`PENDING_PAYMENT`) | `RESERVE`, one per line item, same transaction as the order/order-item insert |
| A payment attempt fails, order stays `PENDING_PAYMENT` | **No inventory action at all** — the reservation is left intact so the customer can retry against the same order |
| A payment attempt reaches `SUCCESS`, order → `PAID` | `SALE`, same transaction as the order's status write |
| Order `CANCELLED` (admin action or TTL sweep with zero successful attempts) | `RELEASE`, same transaction as the status write |
| Order `REFUNDED` | **No automatic inventory movement** — a physically-returned item is a manual `RETURN`/`ADJUSTMENT`, entered once it's actually back |

This means: **Phase 5 builds `reserveInventory`/`releaseInventory`/
`completeInventorySale` as inventory-owned primitives that a *future* Order
module's checkout/cancellation use-cases and a *future* Payment module's
webhook-processing worker will call as one step of their own larger
transactions** — Phase 5 does not build those callers (§15). Nothing in
Phase 5 ever creates a `payment_attempt_id`-keyed reference anywhere in
the inventory domain.

---

## 7. Concurrency strategy

**This is the plan's central design decision, and it deliberately does
NOT reuse Phase 4's `SELECT ... FOR UPDATE` mechanism for reservation.**
The two domains have genuinely different shapes: Phase 4's default-variant
invariant is a **multi-row, decision-dependent** invariant (which
*specific* remaining variant becomes the new default requires reading and
comparing several rows before deciding what to write) — that decision
cannot be expressed as a single `WHERE` clause, so it needs an explicit
lock to serialize the read-decide-write sequence. Inventory reservation is
a **single-row, condition-expressible** operation — "does this one row
currently have enough available quantity" is exactly a `WHERE` predicate,
and MySQL's own `UPDATE ... WHERE` semantics already provide the
serialization for free, with no separate lock statement needed. Using an
explicit lock here would be redundant machinery solving a problem the
`UPDATE` statement itself already solves — and would risk exactly the kind
of complexity that produced Phase 4's own pre-lock-snapshot bug.

This is not a new decision — it is `docs/DATABASE_DESIGN.md` §5/§21 and
§22's **already-approved, already-explained** mechanism, restated here
precisely because Phase 5 must implement it exactly as designed:

### Reservation

```sql
UPDATE inventory_items
SET quantity_reserved = quantity_reserved + :qty
WHERE product_variant_id = :variantId
  AND quantity_available >= :qty;   -- the generated column, directly
-- 0 rows affected ⇒ insufficient stock ⇒ ROLLBACK the whole transaction
```

In Prisma, expressed as `updateMany` (not `update`, since `update`
requires a unique-and-guaranteed-to-match `where` and has no "0 rows
affected" outcome — `updateMany` returns `{ count: number }`, which is
exactly the compare-and-swap result this pattern needs):

```ts
const result = await tx.inventoryItem.updateMany({
  where: { productVariantId: variantId, quantityAvailable: { gte: qty } },
  data: { quantityReserved: { increment: qty } },
});
if (result.count === 0) {
  throw new ValidationError("Insufficient available stock.");
}
```

**Why this is a genuine compare-and-swap, not a read-then-write race**
(`docs/DATABASE_DESIGN.md` §22, restated for Phase 5's implementation):
InnoDB row-locks the matched `inventory_items` row for the first
transaction to reach this statement; a second, concurrent transaction's
identical `UPDATE` **blocks** until the first commits or rolls back, then
re-evaluates its own `WHERE quantityAvailable >= :qty` against the
**post-first-transaction** row — not a stale value read earlier. Two
customers racing for the last unit: the first's `UPDATE` succeeds (moves
`reserved` up, `available` down accordingly); the second's `UPDATE`,
unblocked afterward, re-checks against the now-lower `available` and
correctly affects 0 rows if there isn't enough left. This requires no
`SELECT ... FOR UPDATE` at all — the `UPDATE`'s own `WHERE` clause,
evaluated at lock-acquisition time, **is** the lock-then-check, in one
atomic statement.

`order_items` must exist *before* the `RESERVE` movement that references
it by `order_item_id` — `docs/DATABASE_DESIGN.md` §5's corrected ordering,
unchanged here. The full reservation write (balance `UPDATE` + movement
`INSERT`) happens inside the **same transaction** the future Order
module's checkout use-case already opens for `orders`/`order_items`
(§6/§15) — `reserveInventory` does not open its own separate, isolated
transaction when called mid-checkout; it participates in the caller's.
When exercised standalone (e.g. Phase 5's own integration tests, absent a
real Order module yet), it opens its own transaction.

### Release

```sql
UPDATE inventory_items
SET quantity_reserved = quantity_reserved - :qty
WHERE product_variant_id = :variantId
  AND quantity_reserved >= :qty;   -- guards against ever going negative
-- 0 rows affected ⇒ integrity error (should never happen if RESERVE
-- always preceded RELEASE for this exact order_item — see idempotency below)
INSERT inventory_movements (RELEASE, reserved_delta = -qty, order_item_id = :id);
```

**Idempotency**: attempted twice for the same `order_item_id`, the second
attempt's `INSERT` hits `uq_one_reserve_release_sale_per_order_item` and
the whole transaction rolls back — including the balance `UPDATE` that
ran just before it in the *same* transaction attempt. This is why
statement **order within one transaction is safe even though the `UPDATE`
runs before the `INSERT`**: MySQL's atomicity guarantees that if the
`INSERT` fails, the preceding `UPDATE` in the same transaction is undone
too, not left half-applied. `releaseInventory` catches this specific
unique-constraint violation and, rather than propagating it as a hard
error, looks up the **already-existing** `RELEASE` movement for this
`order_item_id` (a fresh, separate read, outside the failed/rolled-back
transaction) and returns it as the successful, idempotent result — a
retried release call is indistinguishable in outcome from the first.

### Sale

```sql
UPDATE inventory_items
SET quantity_on_hand = quantity_on_hand - :qty,
    quantity_reserved = quantity_reserved - :qty
WHERE product_variant_id = :variantId
  AND quantity_reserved >= :qty;   -- same defensive guard as RELEASE
INSERT inventory_movements (SALE, on_hand_delta = -qty, reserved_delta = -qty, order_item_id = :id);
```

Same idempotency mechanism as `RELEASE` — the dedup key rejects a second
`SALE` for the same `order_item_id`, the whole transaction (including its
balance `UPDATE`) rolls back, and `completeInventorySale` catches that
specific violation and returns the existing `SALE` movement as success.
**This is layered, not the only guard**: the future Payment module's own
conditional order-status `UPDATE ... WHERE status = 'PENDING_PAYMENT'`
(`docs/ARCHITECTURE.md` §6.5/§7) is checked by the *caller* before it even
invokes `completeInventorySale` — two independent idempotency layers, per
the already-approved design, not something Phase 5 invents on top.

### Adjustment (the one operation that genuinely needs a lock)

Reservation/release/sale are all **blind relative updates guarded by a
`WHERE` predicate** — no value needs to be read first. An admin-facing
adjustment that lets staff type an **absolute target quantity** (for
usability — `docs/DATABASE_DESIGN.md` §22's explicit recommendation
carried into this phase) is different: the delta to apply depends on the
*current* value, which must be read before it can be computed. This is a
genuine read-then-decide-then-write, and it does need an explicit lock —
`SELECT quantity_on_hand FROM inventory_items WHERE id = :id FOR UPDATE`,
as the transaction's first statement, then compute
`delta = targetQuantity - currentOnHand` in application code using
`Decimal` arithmetic (§4), then apply it as a normal guarded relative
`UPDATE` (`quantity_on_hand = quantity_on_hand + :delta WHERE id = :id AND
quantity_on_hand + :delta >= 0`), then insert the `ADJUSTMENT` movement
with the computed delta recorded in `on_hand_delta`. **Two concurrent
absolute-target adjustments on the same item correctly serialize**: the
second's `FOR UPDATE` blocks until the first commits, then reads the
*already-adjusted* value and computes its own delta relative to that —
never overwriting the first admin's change (`docs/DATABASE_DESIGN.md`
§22's explicit "two concurrent relative deltas commute" reasoning,
extended here to the read-then-compute-then-apply case that produces one).
A caller supplying a raw **delta directly** (no absolute target) skips the
lock entirely and uses the same blind guarded relative `UPDATE` as
`RESTOCK` — no read needed when the caller already knows the delta.

---

## 8. Locking strategy summary

| Operation | Lock mechanism | Why |
|---|---|---|
| `RESERVE` | None — atomic guarded `UPDATE ... WHERE quantityAvailable >= qty` | Single-row, condition-expressible in one `WHERE` |
| `RELEASE` | None — atomic guarded `UPDATE ... WHERE quantityReserved >= qty` | Same reasoning |
| `SALE` | None — atomic guarded `UPDATE ... WHERE quantityReserved >= qty` | Same reasoning |
| `RESTOCK` | None — blind `UPDATE ... SET quantityOnHand = quantityOnHand + qty` | Always valid to add stock; no condition to guard |
| `RETURN` | None — same as `RESTOCK` | Same reasoning |
| `ADJUSTMENT` (delta given directly) | None — same guarded pattern as `RESTOCK`/`RELEASE` | No read needed |
| `ADJUSTMENT` (absolute target given) | `SELECT ... FOR UPDATE` on the `inventory_items` row, first statement in the transaction | Delta must be computed from a value read under lock — the one genuine read-then-write in this domain |

No operation in this domain locks the `product_variants` or `products`
row the way Phase 4's catalog locking does — inventory's invariants are
scoped entirely to the `inventory_items`/`inventory_movements` pair, never
requiring cross-table serialization with the catalog domain.

---

## 9. Use-case inventory

Derived from the schema and the above design, not copied from the brief's
illustrative list:

| Use-case | Actor param? | Permission | Notes |
|---|---|---|---|
| `getInventoryForVariant(actor, variantId)` | Yes | `inventory.read` | Returns balance + threshold for one variant; `NotFoundError` if no `InventoryItem` row exists yet (a real, distinct state, §1) |
| `listInventory(actor, filters, cursor)` | Yes | `inventory.read` | Keyset-paginated (Phase 4 convention), filterable by low-stock (`quantityAvailable <= lowStockThreshold`) |
| `getInventoryMovementHistory(actor, inventoryItemId, cursor)` | Yes | `inventory.read` | Keyset-paginated ledger view, newest first |
| `restockInventory(actor, { variantId, quantity, referenceType?, referenceId?, note? })` | Yes | `inventory.adjust` | Creates the `InventoryItem` row if it doesn't exist yet (first-ever stock for a variant); otherwise a blind guarded `+qty` `UPDATE`. Writes `RESTOCK` + an `audit_logs` entry (admin-initiated) |
| `adjustInventory(actor, { variantId, delta } \| { variantId, newQuantity }, note)` | Yes | `inventory.adjust` | `note` mandatory (Zod-enforced). Two mutually exclusive input shapes per §7/§12 — exactly one of `delta`/`newQuantity`. Writes `ADJUSTMENT` + an `audit_logs` entry |
| `recordInventoryReturn(actor, { variantId, quantity, orderItemId?, note? })` | Yes | `inventory.adjust` | Blind guarded `+qty` `UPDATE`; writes `RETURN` (no dedup constraint, repeats legitimate) |
| `getAvailableQuantity(variantId)` | **No** | none (public-safe read) | Framework-agnostic helper for future storefront "in stock"/"low stock" display; returns only `quantityAvailable` (never `quantityOnHand`/`quantityReserved`, which are internal operational figures, not customer-facing) |
| `reserveInventory({ orderItemId, variantId, quantity })` | **No** | none — inter-module contract | §6/§7/§15; no HTTP route in Phase 5 |
| `releaseInventory({ orderItemId })` | **No** | none — inter-module contract | §6/§7/§15; no HTTP route in Phase 5 |
| `completeInventorySale({ orderItemId })` | **No** | none — inter-module contract | §6/§7/§15/§16; no HTTP route in Phase 5 |

The last three take no `actor` because they are never directly reachable
from an HTTP request in this phase — they are plain function calls a
future Order/Payment module's already-authorized use-case makes as one
step of its own transaction, exactly as `src/modules/auth/use-cases/get-current-user.ts`
is a framework-agnostic primitive other code calls, not an
independently-authorized action.

For every permission-gated use-case, `requirePermission(actor, ...)` is
called first, before any repo access — the established Phase 3/4
convention, unchanged.

---

## 10. Authorization

**No new permission keys are required.** `prisma/seed-data.ts` already
seeds exactly the two permissions this domain needs:

```ts
"inventory.read",     // seeded to both `staff` and `super_admin`
"inventory.adjust",   // seeded to `super_admin` only
```

| Action | Permission |
|---|---|
| View inventory balance / list / movement history | `inventory.read` |
| Restock, adjust, record a return | `inventory.adjust` |
| Reserve / release / convert-to-sale | *(no permission check — inter-module contract, §9)* |

This matches the already-seeded staff/super_admin split exactly: `staff`
can see stock levels (useful for order fulfillment/customer service) but
cannot alter them; only `super_admin` can restock or correct inventory —
consistent with `inventory.adjust` being, per `docs/DATABASE_DESIGN.md` §5
invariant 9, "the single most abuse-prone inventory operation." No
`inventory.reserve`/`inventory.release`/`inventory.sale` permission family
is invented, because those three operations are never directly
human-invoked in this design (§9) — inventing permissions for actions
nothing ever checks against would be exactly the kind of speculative RBAC
surface the instruction warns against.

---

## 11. Stock receipt (`restockInventory`)

```
inventory item (created if absent) → RESTOCK movement → quantity_on_hand increases → quantity_available increases
```

- **Quantity validation**: positive, non-zero `Decimal`, ≤3 decimal
  places (§4).
- **Decimal quantities**: preserved — a cable restock of `500.000` meters
  is exactly as valid as a panel restock of `50.000` units; the use-case
  never branches on `unitOfMeasure` (that's a `products` table concern,
  §4/§19 of `docs/DATABASE_DESIGN.md` already settled this — the inventory
  column type is uniform regardless of what's being counted).
- **Unit-of-measure**: not read or validated by the inventory module at
  all — `products.unit_of_measure` (`EACH`/`METER`) is a *display* hint
  for the storefront/admin UI (whether to render a stepper or a decimal
  length input), not an inventory business rule; the ledger stores
  whatever quantity it's given.
- **Reason/reference fields**: `referenceType`/`referenceId` optional,
  `note` optional (unlike `ADJUSTMENT`, where `note` is mandatory — a
  restock's "reason" is usually self-evident, a delivery arrived; an
  `ADJUSTMENT` exists specifically *because* something doesn't
  self-explain).
- **Idempotency**: no schema-level exactly-once guarantee exists for
  `RESTOCK` (repeated legitimate restocks are the normal case) — a
  double-submitted restock request (e.g. a double-clicked "confirm
  delivery" button) is a use-case-level concern; §14 defines the mitigation
  (a short client-side/idempotency-key-based guard is a documented,
  explicitly-deferred enhancement, not built in Phase 5 — see §20 Open
  Questions).
- **Audit**: `created_by` set to the acting admin's id, plus a mirrored
  `audit_logs` entry (`action: "inventory.restock"`, `entityType:
  "inventory_item"`) — the same two-independent-trails pattern
  `docs/DATABASE_DESIGN.md` §5 invariant 9 specifies for `ADJUSTMENT`,
  applied here too since both are equally "an admin changed how much
  stock exists."
- **Authorization**: `inventory.adjust`.

---

## 12. Manual adjustments (`adjustInventory`)

Explicit, audited, reasoned, attributable — never a silent overwrite of
history:

- **Input shape**: exactly one of `{ delta: Decimal }` (admin already
  knows the correction amount) or `{ newQuantity: Decimal }` (admin knows
  the *counted* total, e.g. after a physical stocktake) — Zod-enforced
  mutual exclusivity via a `superRefine` (an admin-facing form may offer
  either UX, per `docs/DATABASE_DESIGN.md` §22's explicit accommodation).
- **Can be positive or negative**: yes, both — a stocktake might reveal
  *more* physical stock than the ledger shows (damaged-item write-offs
  previously over-corrected, a prior movement entered wrong) just as
  plausibly as less.
- **What prevents an invalid resulting `on_hand`**: the guarded relative
  `UPDATE`'s own `WHERE quantity_on_hand + :delta >= 0` clause is the
  primary defense (an application-level compare-and-swap, matching §7's
  pattern); `chk_inventory_items_on_hand_nonneg` is the database-level
  defense-in-depth backstop if that guard were ever bypassed. A negative
  delta that would drive `on_hand` below `reserved` is separately rejected
  by `chk_inventory_items_reserved_le_on_hand` — an adjustment can reduce
  on-hand stock, but never below what's currently reserved against live
  orders (attempting to would mean an already-reserved unit no longer
  physically exists, which is a real operational problem the system
  refuses to silently paper over — it must be resolved by *first*
  releasing/cancelling the conflicting reservation through the order
  lifecycle, a future-phase concern this plan does not solve here).
- **`note` is mandatory** (Zod-enforced, non-empty, per
  `docs/DATABASE_DESIGN.md` §5 invariant 9 — "app-enforced NOT NULL-in-practice
  via the use-case, even though the column itself is nullable to
  accommodate system-driven types").
- **Authorization**: `inventory.adjust`.
- **Concurrency/locking**: §7's dedicated treatment — the one operation in
  this domain needing `SELECT ... FOR UPDATE`, only on the
  `newQuantity`-supplied path.

---

## 13. Decimal quantities — summary (full detail in §4)

`DECIMAL(12,3)` preserved everywhere; SQL-side relative arithmetic only;
`Prisma.Decimal` (never `Number`) for the one JS-side computation
(absolute-target adjustment's delta); minimum precision `0.001`,
Zod-validated; no rounding policy applied anywhere in this domain.

---

## 14. Idempotency

| Scenario | Outcome |
|---|---|
| Duplicate `RESERVE` (same `order_item_id` submitted twice) | Second attempt's movement `INSERT` hits the dedup unique index; whole transaction (including its balance `UPDATE`) rolls back. The caller (future checkout use-case) is expected to not call this twice for the same line in the normal case; `reserveInventory` itself catches the violation and returns the existing reservation as success rather than a hard error, exactly like `RELEASE`/`SALE` (§7) |
| Duplicate `RELEASE` | Same mechanism — §7 |
| Duplicate `SALE` (webhook processed twice) | Same mechanism — §7, layered under the caller's own conditional order-status `UPDATE` per `docs/ARCHITECTURE.md` §6.5/§7 |
| Worker/process crash **before** the movement `INSERT` | Nothing committed — the whole transaction never happened from the database's point of view; a retry runs the full sequence fresh, exactly once |
| Worker/process crash **after** the movement `INSERT` commits, before the caller's own response/next-step | The movement (and its balance change) are durably committed — a retry hits the idempotent-catch path above and returns the already-true state, never double-applies |
| Worker/process crash **between** the balance `UPDATE` and the movement `INSERT`, mid-transaction | Impossible to observe as a partial state — both statements are inside one database transaction; a crash before `COMMIT` rolls back everything, a crash after `COMMIT` has both already durably applied. There is no third outcome |

No external queue/retry-broker requirement is introduced for Phase 5 — the
approved architecture already treats "movement insert + derived balance
change" as a single database-transactional unit (`docs/ARCHITECTURE.md`
§7), which is what makes crash-safety a property of the transaction
itself rather than something an external mechanism needs to provide.

`RESTOCK`/`ADJUSTMENT`/`RETURN` have no schema-level exactly-once
constraint (intentionally — repeats are legitimate business events for
all three). A double-submitted *identical* restock/adjustment (e.g. a
double-clicked button) is **explicitly flagged as an open question**
(§20) rather than silently solved — closing it would likely mean an
idempotency-key column this schema doesn't have, which is a decision for
explicit approval, not something this plan invents.

---

## 15. Order interaction — the contract Phase 5 exposes, Order (later phase) consumes

```ts
// Called by the future checkout use-case, as one step of its own
// order + order_items transaction (§6/§7):
reserveInventory(params: {
  orderItemId: bigint;
  variantId: bigint;
  quantity: Decimal;
}): Promise<{ movementId: bigint }>;   // throws ValidationError on insufficient stock

// Called by the future order-cancellation / TTL-sweep use-case:
releaseInventory(params: { orderItemId: bigint }): Promise<{ movementId: bigint }>;

// Called by the future payment-webhook-processing worker, only after its
// own conditional order-status UPDATE has confirmed this is the first
// time this order is transitioning to PAID:
completeInventorySale(params: { orderItemId: bigint }): Promise<{ movementId: bigint }>;
```

**Inventory owns inventory state; Order owns order state** — none of
these three functions ever reads or writes `orders.status`, and no future
Order use-case ever writes directly to `inventory_items`/
`inventory_movements`. The dividing line is exactly the one
`docs/ARCHITECTURE.md` §7's table already draws: an order-lifecycle event
*triggers* an inventory action, inside the *same* transaction as the
order-side write, but the inventory action's own internal logic (the
guarded `UPDATE`, the movement insert, the idempotent-retry catch) is
entirely this module's responsibility, exposed as a plain function the
caller awaits.

**How Phase 5 itself calls these**: standalone, each opens and fully
manages its own `db.$transaction(...)` inside `repo.ts` — this is the only
mode Phase 5 needs, since no real caller exists yet, and it's exactly how
Phase 5's own integration tests exercise them.

**Cross-module transaction composition is deliberately left as an open
question (§25), not decided here.** `docs/DATABASE_DESIGN.md` §21's
checkout transaction shows the `orders`/`order_items` inserts and the
`inventory_items` reservation `UPDATE` inside **one** transaction — a real,
approved requirement this plan does not question. But *how* a future
Order module's repo composes that single transaction with Inventory's
already-built reservation logic is a genuine architectural decision this
plan is not positioned to make correctly right now: the established
convention ("only `repo.ts` imports Prisma," one repo per module) has
never yet had to solve one module's transaction needing to include a
write that's semantically owned by a different module's repo, and
resolving it wrongly here — e.g., by having `reserveInventory` accept a
`Prisma.TransactionClient` parameter, which would leak a `@prisma/client`
type into whatever layer holds and passes that client — risks quietly
weakening a boundary rule Phase 1 established and Phase 4 relied on
directly (`docs/PHASE_4_CATALOG_IMPLEMENTATION.md` §3's `domain/`
relocation). The real options (repo-to-repo Prisma composition as a
narrow, explicit exception; the future Order repo duplicating the guarded
`UPDATE`/`INSERT` pattern directly for its own transaction; or some other
mechanism) should be decided when the Order module is actually planned,
with the then-current shape of that module in view — not speculatively
committed to now. Phase 5's contract functions are written to be callable
standalone today; adapting them for in-transaction composition is
explicitly deferred, flagged, and not silently pre-decided.

---

## 16. Payment interaction boundary

```
Payment success (future Payment module, async webhook worker)
      ↓
Order becomes PAID (future Order module, conditional UPDATE)
      ↓
completeInventorySale() called as one step of that same transaction
      ↓
Inventory converts RESERVE → SALE
```

The inventory module **never calls Paystack, never reads a
`payment_attempts` row, and never knows what a webhook is** — its only
awareness of "a sale happened" is the plain `completeInventorySale(
{orderItemId} )` call it receives. The future Payment/Order modules
orchestrate the full sequence; Phase 5 builds only the one link in that
chain this domain owns.

---

## 17. Ledger invariants — what enforces each one

| Invariant | Enforced by |
|---|---|
| `on_hand >= 0` | Database `CHECK` (`chk_inventory_items_on_hand_nonneg`), already migrated; the use-case's guarded `UPDATE ... WHERE` (§7/§12) is the primary defense that keeps this from ever being tested in practice |
| `reserved >= 0` | Database `CHECK` (`chk_inventory_items_reserved_nonneg`), already migrated; same use-case-level primary defense |
| `reserved <= on_hand` | Database `CHECK` (`chk_inventory_items_reserved_le_on_hand`), already migrated; the `RESERVE` use-case's `WHERE quantityAvailable >= qty` guard is the primary defense |
| `available = on_hand - reserved` | Database `GENERATED ALWAYS AS ... STORED` column — not an application invariant at all; structurally impossible to violate |
| At most one `RESERVE` per `order_item_id` | Database unique index on the generated `order_item_movement_dedup_key` |
| At most one `RELEASE` per `order_item_id` | Same unique index |
| At most one `SALE` per `order_item_id` | Same unique index, **plus** the caller's own conditional order-status `UPDATE` (application-transaction layer, per §16) |
| `order_item_id` required for `RESERVE`/`RELEASE`/`SALE` | Database `CHECK` (`chk_inventory_movements_order_item_required`), already migrated |
| Ledger sums reconcile to current balances | Application-level, on-demand consistency check only (§5) — not continuously enforced by any constraint, since the running balance is maintained transactionally alongside every insert, not recomputed from the ledger on every read |

Every row in this table maps to something **already migrated and already
confirmed rejecting bad writes** in Phase 2B's negative-test suite
(`docs/PHASE_2B_REPORT.md` §F) — Phase 5 does not need to (and does not)
add any new database constraint to make these hold.

---

## 18. Inventory auditability

For `RESTOCK`/`ADJUSTMENT`/`RETURN` (the human-initiated movements),
every mutation already carries, via existing columns:

- **Who**: `inventory_movements.created_by` (nullable, set for
  human-initiated types) + a mirrored `audit_logs` row (`actor_id`,
  `actor_type = 'USER'`) for `RESTOCK`/`ADJUSTMENT` specifically —
  matching `docs/DATABASE_DESIGN.md` §5 invariant 9's "two independent
  trails for the single most abuse-prone inventory operation," extended
  to `RESTOCK` for consistency (both are staff-initiated stock changes of
  equivalent sensitivity). `RETURN` does not get a separate `audit_logs`
  row — it's the same sensitivity class as `RESTOCK` but the ledger entry
  itself, plus the optional `order_item_id` link, already answers "who
  caused it" precisely enough (a documented customer return), unlike a
  pure `ADJUSTMENT`/`RESTOCK` which has no such external anchor.
- **What changed**: `on_hand_delta`/`reserved_delta` (the exact signed
  quantities).
- **Why**: `note` (mandatory for `ADJUSTMENT`, optional elsewhere).
- **Which order caused it**: `order_item_id`, when applicable.
- **When**: `created_at`.

No second inventory-specific audit table is created — the existing
`inventory_movements` ledger (append-only by design) already *is* the
audit trail for every movement, and the existing `audit_logs` table
(`docs/DATABASE_DESIGN.md` §15, already built, not modified) is reused
for the human-initiated subset exactly as designed, matching how Phase 4
reused it for catalog mutations rather than inventing a parallel
mechanism.

---

## 19. Performance

- **Indexed variant lookup**: `inventory_items.product_variant_id` is
  already `@unique` (a unique index) — every reservation/sale/release
  lookup by variant is a direct indexed hit, no scan.
- **Indexed movement lookup**: `inventory_movements` already has
  `(inventory_item_id, created_at)` (per-item ledger history, chronological),
  `(order_item_id)` (movements caused by a specific order line), and
  `(reference_type, reference_id)` (purchase-order-driven lookups) —
  `docs/DATABASE_DESIGN.md` §18, already migrated. Phase 5's
  `getInventoryMovementHistory` use-case queries via the first index
  exclusively.
- **Short transactions**: every write transaction in this domain is at
  most two statements (one guarded `UPDATE`, one `INSERT`) plus, for the
  absolute-target adjustment path, one preceding locking `SELECT` — no
  transaction in this module ever spans an external network call (no
  Paystack, nothing) or a multi-row decision loop the way Phase 4's
  category-reparent cycle-check does.
- **Row-level locking, never table-level**: every guard is a `WHERE`
  clause matching exactly one row (`product_variant_id = :id` or
  `id = :id`) — InnoDB locks only that row, never the table.
- **No read-modify-write race**: §7's entire design is built around
  avoiding this pattern; the one place a read genuinely precedes a write
  (absolute-target adjustment) uses an explicit lock specifically because
  the read-then-write shape is otherwise unavoidable there.
- **No N+1 movement queries**: `listInventory` selects `InventoryItem`
  rows directly (no per-row movement fetch); movement history is only
  fetched by `getInventoryMovementHistory`, one item at a time, on
  explicit request — never eagerly joined into a listing.
- **Pagination**: keyset (cursor), matching Phase 4's established
  convention — `listInventory` cursors on `(updatedAt, id)` or plain `id`;
  `getInventoryMovementHistory` cursors on `(createdAt, id)` descending
  (newest first, matching the existing index's leading columns).
- **Aggregation**: none needed at Phase 5's scope — `quantity_available`
  is already a per-row `STORED` value, not something computed via
  `SUM()`/`GROUP BY` at read time.
- No Redis, no Elasticsearch, no cache-as-correctness-mechanism —
  everything above relies on indexes and transaction scoping already in
  place or directly achievable with the existing schema.

---

## 20. Test matrix

### Unit (pure, no I/O)
- Quantity validation: rejects non-positive, rejects >3 decimal places,
  accepts exactly `0.001`.
- Decimal-delta computation for the absolute-target adjustment path
  (`newQuantity - currentOnHand`, using `Prisma.Decimal` arithmetic, not
  `Number`).
- Movement-semantics table (§3) expressed as pure data — e.g. a lookup
  function `deltasForMovementType(type, qty) -> {onHandDelta, reservedDelta}`
  tested against every one of the six types.
- Availability calculation (`onHand - reserved = available`) as a pure
  function, mirroring what the generated column does, for use in any
  application-level display logic that can't just read the column
  directly (e.g. previewing an adjustment's effect before submission).

### Integration (real MySQL)
- `RESTOCK` on a variant with no prior `InventoryItem` row — creates it.
- `RESTOCK` on an existing item — increments correctly.
- Positive `ADJUSTMENT` (delta) and negative `ADJUSTMENT` (delta) —
  correct resulting balance, movement recorded, `note` required.
- Absolute-target `ADJUSTMENT` — correct delta computed and recorded.
- `RESERVE` — success path, decrements `available`, movement recorded
  with `order_item_id`.
- `RESERVE` with exactly the available quantity — succeeds (boundary,
  not off-by-one rejected).
- `RESERVE` with one more than available — rejected, `ValidationError`,
  no partial state.
- `RELEASE` — reverses a `RESERVE`, `available` restored.
- `SALE` — converts a `RESERVE` into a permanent deduction, both
  `on_hand` and `reserved` drop.
- Fractional quantities (`2.500`) through the full
  restock → reserve → sale lifecycle, asserting exact `Decimal` equality
  at every step (never an approximately-equal float check).
- Duplicate `RESERVE` for the same `order_item_id` — rejected/idempotent
  per §14, final state unchanged from the first call's result.
- Duplicate `RELEASE` — same.
- Duplicate `SALE` — same.
- Invalid `order_item_id` association — `RESERVE`/`RELEASE`/`SALE`
  against a nonexistent or foreign `order_item_id` behaves per the FK
  (`RESTRICT`), surfaced as a clean `NotFoundError`, not a raw Prisma
  error.
- Unauthorized adjustment attempt (customer, or staff without
  `inventory.adjust`) — `ForbiddenError`.
- Attempted negative resulting stock (adjustment delta more negative than
  current `on_hand`) — rejected by the guarded `UPDATE`, `on_hand`
  unchanged.
- Attempted adjustment that would drive `on_hand` below `reserved` —
  rejected.

### Concurrency (real MySQL, genuinely overlapping `Promise.allSettled`/
`Promise.all`, final database state asserted directly — matching Phase
4's established rigor exactly, including the "found and fixed a real bug"
precedent that makes this section non-negotiable):
1. Two reservations competing for the last available unit — asserts
   exactly one succeeds, `quantity_available` never goes negative.
2. A reservation racing an `ADJUSTMENT` (delta) on the same item — asserts
   final `on_hand`/`reserved`/`available` are all internally consistent
   (`reserved <= on_hand`, `available = on_hand - reserved`) regardless of
   ordering.
3. Two concurrent `RELEASE` calls for the same `order_item_id` — asserts
   exactly one `RELEASE` movement row exists, `reserved` decremented
   exactly once.
4. Two concurrent `completeInventorySale` calls for the same
   `order_item_id` — asserts exactly one `SALE` movement row exists,
   balance decremented exactly once.
5. Duplicate `SALE` processing simulated as a direct repeated call (not
   just concurrent) — asserts the second call returns the same movement
   id as the first, no double-deduction.
6. A reservation retried after a simulated transaction failure (e.g. the
   movement insert intentionally made to fail once via a test hook) —
   asserts no partial balance change survives the rollback, and the retry
   succeeds cleanly.
7. Two concurrent absolute-target `ADJUSTMENT` calls on the same item —
   asserts the lock correctly serializes them and the second's delta is
   computed against the first's already-applied result, not a stale read
   (this is the direct inventory-domain analogue of Phase 4's
   snapshot-poisoning bug, and this plan commits to testing it explicitly
   given that precedent).

Every concurrency test re-reads final state directly from the database,
never inferring correctness from which promise resolved/rejected alone —
the same discipline Phase 4's revision established.

---

## 21. Failure/retry behavior

Covered precisely in §14's table. Two additional scenarios named by the
instruction, addressed explicitly:

- **Reservation exists, payment attempt fails**: no inventory action at
  all (§6's table) — the reservation survives untouched, by design, so the
  customer can retry payment against the same order without re-reserving.
- **Reservation exists, order is cancelled**: `releaseInventory` is called
  by the future Order module's cancellation use-case — Phase 5 builds the
  primitive; the actual trigger (an admin clicking "cancel," or a TTL
  sweep) is Order-module scope, not built here. This is stated as a
  boundary, not an omission.

---

## 22. Architecture

Identical layering to Phase 3/4, no deviation:

```
Route Handler (minimal, §23) / future Order-or-Payment-module use-case
        ↓
Inventory Use-case (src/modules/inventory/use-cases/*.ts)
        ↓
Inventory Repository (src/modules/inventory/repo.ts — the only file here
                       allowed to import Prisma; owns every $transaction)
        ↓
Prisma
        ↓
MySQL
```

Module structure, matching the established (and, per Phase 4's own
documented correction, ESLint-boundary-aware) convention:

```
src/modules/inventory/
  types.ts        # safe projections: InventoryBalance, InventoryMovementRecord, CursorPage<T>
  constants.ts    # permission keys, movement-type constants, pagination bounds
  schema.ts       # Zod input schemas (restock, adjust, return, list/history filters)
  quantity.ts     # pure Decimal validation/precision helpers — NOT under domain/,
                  #   for the same reason Phase 4's slug.ts/default-variant.ts
                  #   were relocated: repo.ts needs to call these from inside
                  #   its locked/guarded transactions, and the pre-existing
                  #   boundaries/dependencies ESLint rule forbids repo.ts from
                  #   importing anything classified as `domain`
  domain/
    movement-semantics.ts   # pure per-type delta table (§3), used by schema.ts
                             #   and by use-cases — not called from repo.ts,
                             #   so this one CAN stay under domain/
  repo.ts         # the only file importing Prisma; every guarded UPDATE,
                  #   every $transaction, the one FOR UPDATE lock (§7/§12)
  use-cases/
    get-inventory-for-variant.ts
    list-inventory.ts
    get-inventory-movement-history.ts
    restock-inventory.ts
    adjust-inventory.ts
    record-inventory-return.ts
    get-available-quantity.ts
    reserve-inventory.ts
    release-inventory.ts
    complete-inventory-sale.ts
```

This file layout is decided **in the plan itself**, learning directly
from Phase 4's post-hoc relocation — `quantity.ts` is placed outside
`domain/` from the start, rather than being written under `domain/` and
needing a documented correction later, since the same "repo.ts needs it
inside a transaction" reasoning applies identically here. `movement-semantics.ts`
stays under `domain/` because — like Phase 4's `specification-key.ts`/
`money.ts` — it's only consumed by `schema.ts`/use-cases, never by
`repo.ts` directly.

---

## 23. API/UI scope

**No inventory dashboard, no warehouse UI, no stock tables.** Per the
instruction, minimal Route Handlers may be planned only if needed to
exercise the use-case layer for e2e coverage, matching Phase 3/4's exact
precedent (a thin HTTP slice, not a feature surface):

```
app/api/admin/inventory/[variantId]/route.ts            # GET (balance), inventory.read
app/api/admin/inventory/route.ts                          # GET (list), inventory.read
app/api/admin/inventory/[variantId]/movements/route.ts   # GET (history), inventory.read
app/api/admin/inventory/[variantId]/restock/route.ts     # POST, inventory.adjust
app/api/admin/inventory/[variantId]/adjust/route.ts      # POST, inventory.adjust
app/api/admin/inventory/[variantId]/return/route.ts      # POST, inventory.adjust
```

`reserveInventory`/`releaseInventory`/`completeInventorySale` get **no
Route Handler at all** in Phase 5 — they have no legitimate direct HTTP
caller yet (that's precisely the future Order/Payment modules' job), and
exposing them via HTTP now would create an attack surface for an action
that should only ever happen as a side effect of a real checkout/webhook
flow. They are exercised entirely via integration tests calling the
use-cases directly, exactly like several of Phase 4's use-cases were
(`docs/PHASE_4_CATALOG_IMPLEMENTATION.md` §12's documented, deliberate
"14 of 34 use-cases have no Route Handler" precedent).

---

## 24. Database changes

**None required, and none proposed.** Every column, enum value, generated
column, unique index, and `CHECK` constraint this plan relies on already
exists and is already confirmed correct against the real database
(`docs/PHASE_2B_REPORT.md` §E/§F). No schema deficiency was found during
this review — the approved Phase 2A/2B inventory design already
anticipated every mechanism Phase 5 needs (the dedup key, the
order-item-required `CHECK`, the three balance `CHECK`s, the generated
`quantity_available` column). If a genuine deficiency had been found, this
plan would stop and report it per the instruction's explicit rule — none
was.

---

## 25. Open questions (flagged, not silently decided)

1. **Idempotency-key protection for `RESTOCK`/`ADJUSTMENT`/`RETURN`
   double-submission** (§14) — no schema-level exactly-once mechanism
   exists for these three types (by design — repeats are legitimate), so
   a genuinely duplicate *accidental* submission (double-clicked button,
   retried form) is not caught at the database level the way
   `RESERVE`/`RELEASE`/`SALE` are. A client-side disabled-button UX
   mitigation is a UI-layer concern (out of Phase 5's scope, §23); a
   server-side idempotency-key column would be a schema change requiring
   explicit approval. **Flagged for a decision, not resolved here.**
2. **Low-stock notification/alerting** — `low_stock_threshold` already
   exists as a column and `listInventory`'s filter can surface
   below-threshold items on request, but no proactive notification
   (email/dashboard badge) is built in Phase 5 — that's an observability/
   notifications-integration concern for a later phase, consistent with
   `src/integrations/notifications/` currently having only the Phase 3
   token-delivery stub.
3. **Whether `RETURN` should ever gate `inventory.adjust` vs. a narrower
   permission** — this plan reuses `inventory.adjust` for `RETURN` (§9/§10)
   since no `inventory.return` permission is seeded and inventing one
   isn't justified by current usage patterns; flagged in case a future
   phase's returns-processing workflow wants a narrower, dedicated
   permission for staff who handle returns but shouldn't otherwise adjust
   stock.
4. **Cross-module transaction composition** (§15) — `docs/DATABASE_DESIGN.md`
   §21 requires the future checkout transaction to include both the
   `orders`/`order_items` writes and the inventory reservation `UPDATE` in
   one atomic transaction, but *how* a future Order-module repo composes
   that single transaction with Inventory's own `repo.ts` logic is not
   decided by this plan — every option carries a real trade-off against
   the established "only `repo.ts` imports Prisma, one repo per module"
   convention (repo-to-repo Prisma composition, callback-injection that
   would leak a Prisma type into a use-case, or duplicated SQL in the
   future Order repo). This is explicitly deferred to whichever phase
   plans the Order module, once that module's actual shape is known,
   rather than speculatively pre-decided here against a module that
   doesn't exist yet. Phase 5 itself is unaffected: its own use-cases and
   tests call `reserveInventory`/`releaseInventory`/`completeInventorySale`
   standalone, each managing its own transaction.

None of these four materially change the approved architecture — each is
a scoped, deferrable decision, not a correction to anything already
settled.

---

## 26. Phase 5 implementation order (for the next turn, once approved)

1. `src/modules/inventory/{types,constants}.ts`
2. `src/modules/inventory/quantity.ts` (pure — placed outside `domain/`
   from the start, §22)
3. `src/modules/inventory/domain/movement-semantics.ts` (pure)
4. `src/modules/inventory/schema.ts`
5. `src/modules/inventory/repo.ts` (every guarded `UPDATE`, the one
   `FOR UPDATE` lock, every `$transaction`)
6. Use-cases, read operations first (`getInventoryForVariant`,
   `listInventory`, `getInventoryMovementHistory`, `getAvailableQuantity`),
   then mutations (`restockInventory`, `adjustInventory`,
   `recordInventoryReturn`), then the three inter-module contract
   functions (`reserveInventory`, `releaseInventory`,
   `completeInventorySale`)
7. Minimal Route Handlers (§23)
8. Unit tests
9. Integration tests, including the full concurrency matrix (§20) —
   run repeatedly (5+ consecutive times, Phase 4's established bar) before
   considering the locking mechanisms verified
10. Security source scan
11. `docs/PHASE_5_INVENTORY_IMPLEMENTATION.md`

---

## 27. Acceptance criteria

- No Prisma schema change, no migration.
- Every movement type's semantics implemented exactly per §3's table —
  no reinterpretation of `RESTOCK`/`RESERVE`/`RELEASE`/`SALE`/`RETURN`/
  `ADJUSTMENT`.
- `quantity_available` never directly written to, anywhere.
- All quantity arithmetic in SQL/`Decimal`, zero JavaScript float
  arithmetic on any inventory quantity.
- Reservation, release, and sale each implemented as the exact atomic
  guarded `UPDATE` + `INSERT` pattern from §7 — no `SELECT ... FOR UPDATE`
  substituted in for these three.
- Absolute-target adjustment implemented with the one genuine
  `SELECT ... FOR UPDATE` lock, correctly serializing concurrent callers.
- Authorization gated by the existing `inventory.read`/`inventory.adjust`
  permissions only — no new permission keys silently seeded.
- All 7 concurrency scenarios (§20) pass against real MySQL, re-run
  repeatedly with zero flakiness, before Phase 5 is reported complete.
- `reserveInventory`/`releaseInventory`/`completeInventorySale` have no
  Route Handler and no `actor` parameter.
- Reservations trace to `order_item_id` only — no code path anywhere
  references a `payment_attempt_id` from the inventory domain.
- Full verification suite (typecheck, lint, format, unit, integration,
  e2e if applicable, build, ESLint boundary re-test, security scan,
  database-cleanliness check) passes, matching Phase 3/4's established
  bar exactly.

---

**PHASE 5 PLAN COMPLETE — AWAITING APPROVAL**

# Phase 6 — Order/Commerce Domain Implementation Plan

**Status: PLAN ONLY. No code, migration, repository, use-case, route, Server
Action, UI, Cart, Checkout, Paystack, webhook, or refund logic has been
written.** Phase 5 (Inventory)'s business behavior, public API surface, and
existing test suite remain unchanged by this plan. The one precisely scoped
exception — a narrowly additive infrastructure extension to
`src/modules/inventory/repo.ts`, required for cross-module transaction
composition and fully specified in §7 — is not yet implemented either; this
plan only designs it. See §7 for the exact boundary between "unchanged" and
"additively extended."

This plan is grounded entirely in the actual current repository state —
`prisma/schema.prisma`, `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`,
`docs/PHASE_2B_REPORT.md`, `docs/PHASE_5_INVENTORY_PLAN.md`,
`docs/PHASE_5_INVENTORY_IMPLEMENTATION.md`, and the existing catalog/inventory/
auth module source — read directly for this plan, not assumed from memory or
from this brief's illustrative examples. Every schema field, enum value,
constraint name, and existing code convention cited below was confirmed
against the actual files.

---

## 1. Actual schema analysis

The Commerce/Payments domain schema already exists in full (migrations
`20260808134322_commerce_domain` and `20260808140413_payments_domain`) —
Phase 6 requires **no migration**. Confirmed sufficient; see this
section's "Schema sufficiency verdict" subsection below for the explicit
verdict on each requirement this plan makes.

### `orders`

```prisma
model Order {
  id          BigInt      @id @default(autoincrement()) @db.UnsignedBigInt
  orderNumber String      @unique @map("order_number") @db.VarChar(30)
  userId      BigInt?     @map("user_id") @db.UnsignedBigInt
  guestEmail  String?     @map("guest_email") @db.VarChar(255)
  guestPhone  String?     @map("guest_phone") @db.VarChar(32)
  status      OrderStatus
  authoritativePaymentAttemptId BigInt? @unique(map: "uq_orders_authoritative_payment_attempt") @map("authoritative_payment_attempt_id") @db.UnsignedBigInt
  subtotalMinor    Int      @map("subtotal_minor") @db.UnsignedInt
  discountMinor    Int      @default(0) @map("discount_minor") @db.UnsignedInt
  deliveryFeeMinor Int      @default(0) @map("delivery_fee_minor") @db.UnsignedInt
  taxMinor         Int      @default(0) @map("tax_minor") @db.UnsignedInt
  totalMinor       Int      @map("total_minor") @db.UnsignedInt
  currency         String   @default("NGN") @db.Char(3)
  customerNote     String?  @map("customer_note") @db.Text
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")
}
```

- Indexes: `idx_orders_user_created (userId, createdAt)`, `idx_orders_status_created (status, createdAt)`.
- FKs: `userId → users.id` (`ON DELETE SET NULL`); `authoritativePaymentAttemptId → payment_attempts.id` (`ON DELETE RESTRICT`).
- **CHECK constraint (MySQL 8.0.16+, DB-enforced, confirmed in migration SQL)**:
  `chk_orders_total_arithmetic`: `total_minor = subtotal_minor - discount_minor + delivery_fee_minor + tax_minor`.
  Any `createOrder`/total-recompute path **must** satisfy this exactly or the
  `INSERT`/`UPDATE` fails at the database level.
- `userId` nullable + `guestEmail`/`guestPhone` present → guest checkout is a
  first-class, already-designed case, not something this plan invents.

### `order_items`

```prisma
model OrderItem {
  id                   BigInt   @id @default(autoincrement()) @db.UnsignedBigInt
  orderId              BigInt   @map("order_id") @db.UnsignedBigInt
  productId            BigInt?  @map("product_id") @db.UnsignedBigInt
  productVariantId     BigInt?  @map("product_variant_id") @db.UnsignedBigInt
  productNameSnapshot  String   @map("product_name_snapshot") @db.VarChar(255)
  skuSnapshot          String   @map("sku_snapshot") @db.VarChar(64)
  variantLabelSnapshot String?  @map("variant_label_snapshot") @db.VarChar(255)
  unitPriceMinor       Int      @map("unit_price_minor") @db.UnsignedInt
  quantity             Decimal  @db.Decimal(12, 3)
  discountMinor        Int      @default(0) @map("discount_minor") @db.UnsignedInt
  taxMinor             Int      @default(0) @map("tax_minor") @db.UnsignedInt
  lineTotalMinor       Int      @map("line_total_minor") @db.UnsignedInt
  createdAt            DateTime @default(now()) @map("created_at")
}
```

- `@@unique([orderId, productVariantId], map: "uq_one_line_per_variant_per_order")`
  — at most one line per variant per order (a repeat variant in a cart must
  merge into one line before order creation, not become two `order_items`
  rows).
- `productId`/`productVariantId` FKs are `ON DELETE SET NULL` and explicitly
  documented as **informational only** — the snapshot fields are the
  historical record of what was purchased, independent of whether the
  product/variant is later edited, archived, or deleted.
- **No CHECK constraint ties `lineTotalMinor` to `unitPriceMinor * quantity`**
  — confirmed deliberate (`docs/DATABASE_DESIGN.md` §7): `quantity` is
  `DECIMAL`, so the raw product can be a fractional-kobo value; rounding is
  an application-layer decision (§15).

### `order_addresses`

```prisma
model OrderAddress {
  id            BigInt           @id @default(autoincrement()) @db.UnsignedBigInt
  orderId       BigInt           @map("order_id") @db.UnsignedBigInt
  type          OrderAddressType // SHIPPING | BILLING
  fullName      String           @map("full_name") @db.VarChar(255)
  phone         String           @db.VarChar(32)
  addressLine1  String           @map("address_line1") @db.VarChar(255)
  addressLine2  String?          @map("address_line2") @db.VarChar(255)
  city          String           @db.VarChar(100)
  state         String           @db.VarChar(100)
  country       String           @default("NG") @db.Char(2)
  postalCode    String?          @map("postal_code") @db.VarChar(20)
  deliveryNotes String?          @map("delivery_notes") @db.Text
  createdAt     DateTime         @default(now()) @map("created_at")
}
```

- `@@unique([orderId, type], map: "uq_order_addresses_order_type")` — at most
  one shipping + one billing row per order.
- **No FK to `addresses` at all** — this is already a fully independent,
  immutable copy, confirmed by `docs/DATABASE_DESIGN.md` §7/§10: "Order
  addresses never reference this table by FK — `order_addresses` is a fully
  independent copy taken at checkout time."

### `order_status_history`

```prisma
model OrderStatusHistory {
  id         BigInt                      @id @default(autoincrement()) @db.UnsignedBigInt
  orderId    BigInt                      @map("order_id") @db.UnsignedBigInt
  fromStatus String                      @map("from_status") @db.VarChar(30)
  toStatus   String                      @map("to_status") @db.VarChar(30)
  actorType  OrderStatusHistoryActorType @map("actor_type") // SYSTEM | ADMIN | WEBHOOK
  actorId    BigInt?                     @map("actor_id") @db.UnsignedBigInt
  note       String?                     @db.VarChar(500)
  createdAt  DateTime                    @default(now()) @map("created_at")
}
```

- `fromStatus`/`toStatus` are plain `VARCHAR(30)`, **not** the `OrderStatus`
  enum type — deliberate, so history rows never break if the enum's value
  set changes later.
- No `updatedAt` — append-only by construction (nothing to update).
- Index: `(orderId, createdAt)`.
- **`OrderStatusHistoryActorType` has exactly three values: `SYSTEM`,
  `ADMIN`, `WEBHOOK` — there is no `CUSTOMER` value.** This directly shapes
  §3's actor-mapping design below; it is not an oversight this plan works
  around, it's the schema as approved.

### `payment_attempts` (read-only from Order's perspective in Phase 6)

```prisma
model PaymentAttempt {
  id                BigInt               @id @default(autoincrement()) @db.UnsignedBigInt
  orderId           BigInt               @map("order_id") @db.UnsignedBigInt
  paystackReference String               @unique @map("paystack_reference") @db.VarChar(100)
  status            PaymentAttemptStatus // INITIATED | PENDING | SUCCESS | FAILED | ABANDONED | INITIALIZATION_FAILED
  refundedAmountMinor            Int  @default(0)
  pendingRefundAmountMinor       Int  @default(0)
  availableRefundableAmountMinor Int? // generated: amount - refunded - pendingRefund
  ...
}
```

- FK `orderId → orders.id` is `ON DELETE RESTRICT`.
- Order module in Phase 6 **never creates or mutates `payment_attempts`
  rows** — that is entirely a future Payment module's own repo, on its own
  table. Order's only touchpoint is reading `authoritativePaymentAttemptId`
  (already on `orders`) and being told, by that future module, "this
  `orderId` + `paymentAttemptId` pair just succeeded" (§8).

### `refunds` — out of scope, referenced only to confirm the boundary

`Refund.orderId → orders.id` (`ON DELETE RESTRICT`). Phase 6 builds no
refund logic; noted only because §10/§11 must correctly *defer* to it, not
because Phase 6 touches it.

### Inventory's existing forward-reference to `order_items` (re-confirmed, unchanged)

`inventory_movements.order_item_id → order_items.id`,
**`ON DELETE RESTRICT ON UPDATE RESTRICT`** (the `RESTRICT` on update is
required because `order_item_id` feeds `inventory_movements`' own generated
`order_item_movement_dedup_key` column). CHECK constraint
`chk_inventory_movements_order_item_required`: `type NOT IN ('RESERVE',
'RELEASE', 'SALE') OR order_item_id IS NOT NULL` — RESERVE/RELEASE/SALE
movements are schema-required to name a real `order_items` row. This is the
FK the mandatory Phase 5 correction (`requireMatchingOrderItem`) was built
against, and it fixes the *necessary internal ordering* of Order's own
creation transaction (§5): an `order_items` row must exist before any
`RESERVE` movement can reference it — reservation-before-order-item-exists
is not just undesirable, it is **schema-impossible**.

### `carts`/`cart_items` (exist already, not built in Phase 6, relevant to §9 only)

```prisma
enum CartStatus { ACTIVE  CONVERTED  ABANDONED }

model Cart {
  id     BigInt @id ...
  userId BigInt? // nullable
  guestTokenHash String? // nullable
  status CartStatus @default(ACTIVE)
  activeCartUserKey  BigInt? @unique(map: "uq_one_active_cart_per_user")   // generated, NULL unless ACTIVE
  activeCartGuestKey String? @unique(map: "uq_one_active_cart_per_guest_token") // generated, NULL unless ACTIVE
}
model CartItem {
  cartId BigInt
  productVariantId BigInt
  quantity Decimal @db.Decimal(12, 3)
  priceSnapshotMinor Int
  @@unique([cartId, productVariantId], map: "uq_cart_items_cart_variant")
}
```

Noted for §9 (Cart → Order boundary): `CartStatus` has **no** intermediate
"checked out" state — only `ACTIVE`/`CONVERTED`/`ABANDONED`. A future
Checkout module transitioning a cart to `CONVERTED` atomically with order
creation is a real, schema-supported design point, but is Checkout's own
transaction to own, not Order's (Order in Phase 6 has no dependency on
`Cart` at all — see §9).

### `addresses` (customer's saved addresses — contrast with `order_addresses`)

```prisma
model Address {
  id       BigInt
  userId   BigInt
  fullName, phone, addressLine1, addressLine2, city, state, country(VarChar(100)), postalCode
  isDefault Boolean
  defaultAddressKey BigInt? @unique(map: "uq_one_default_address_per_user") // generated
}
```

Confirmed: **no FK from `order_addresses` to `addresses`** — editing/
deleting a saved address can never alter a past order's recorded address
(`docs/DATABASE_DESIGN.md` §10). `Address.country` is `VarChar(100)`;
`OrderAddress.country` is `Char(2)` (ISO code) — these are genuinely
different shapes, confirming `order_addresses` is not a lazy copy of
`addresses`'s row shape but its own considered snapshot design.

### Money and quantity (re-confirmed against `docs/ARCHITECTURE.md`/`docs/DATABASE_DESIGN.md` §19, not re-derived)

- Every money column: `INT UNSIGNED`, minor units (kobo). Never
  `FLOAT`/`DOUBLE`/`DECIMAL` for money.
- Every quantity column (`order_items.quantity`, `cart_items.quantity`,
  inventory columns): `DECIMAL(12,3) UNSIGNED`, uniformly — a whole-unit
  product's quantity is simply `1.000`. No branching per product type.

### Double-payment reconciliation — the exact existing design, quoted, not paraphrased

`docs/DATABASE_DESIGN.md` §22 (concurrency table, "Two payment attempts
succeeding unexpectedly"):

> The first `charge.success` to be processed wins the conditional `orders`
> UPDATE (`WHERE status='PENDING_PAYMENT'`) and sets
> `authoritative_payment_attempt_id`. The second's identical UPDATE affects
> 0 rows — its handler must recognize "order already has an authoritative
> attempt" and route to a **manual reconciliation / refund-the-extra-payment**
> path. The schema prevents two attempts from *both* becoming authoritative
> (the `UNIQUE` on `orders.authoritative_payment_attempt_id` plus the
> conditional UPDATE), but it cannot make the *business* problem of a
> genuine double-charge disappear — that needs an operational alert, which
> is a Phase 9/17 observability concern, not a schema gap.

This is the exact acknowledgment referenced in the brief. See §12 for how
Order's own scope ends at "correctly implement the conditional UPDATE and
report which outcome occurred" — the alerting/reconciliation *workflow* is
explicitly out of scope for both Phase 6 and Phase 5-adjacent phases,
deferred to observability work.

### Schema sufficiency verdict

**The existing schema is sufficient for everything this plan proposes to
build in Phase 6.** No migration is required. Every genuine gap found
during this analysis (guest order lookup, checkout-level create-order
deduplication, the `PAID → CANCELLED` refund-flow transition) is a
**scope boundary or a future-phase dependency**, not a missing column —
each is flagged explicitly in §25 rather than worked around with an
invented field.

---

## 2. Order domain model

An order is the immutable commercial record of one purchase transaction.
Exactly which values are captured as snapshots, and from where:

| `order_items` field | Captured from | Why immutable |
|---|---|---|
| `productNameSnapshot` | `products.name` at order-creation read time | Product may be renamed/re-described later |
| `skuSnapshot` | `product_variants.sku` | SKU could theoretically change |
| `variantLabelSnapshot` | `product_variants.variantLabel` (nullable) | Variant option labels may change |
| `unitPriceMinor` | `product_variants.priceMinor` at order-creation read time | Price changes must never rewrite history |
| `quantity` | Customer's resolved cart/checkout input, validated | The exact amount purchased |
| `discountMinor`, `taxMinor` | Computed server-side at creation (§15) | Coupon/tax rules may change later |
| `lineTotalMinor` | Computed server-side, rounded per §15's rule | Must never be recomputed after the fact |
| `productId`/`productVariantId` | Informational FK only (`ON DELETE SET NULL`) | Convenience pointer, not the source of truth |

`order_addresses` captures a full independent copy of the shipping/billing
address (§1) — never a reference to `addresses`. `orders` itself captures
`subtotalMinor`/`discountMinor`/`deliveryFeeMinor`/`taxMinor`/`totalMinor`/
`currency` as the order-level totals, computed once at creation and never
silently recalculated (§15, §18).

No column exists for tax-engine/discount-engine metadata beyond
`Coupon`/`CouponRedemption` (flat/percentage discount only, per the existing
`CouponType` enum) and the flat `taxMinor` fields — Phase 6 builds no new
pricing engine; it computes `discountMinor` from, at most, one
`CouponRedemption` per order (schema-enforced: `CouponRedemption.orderId`
is `@unique`) and treats `taxMinor` as a single server-computed value with
no per-jurisdiction logic invented.

---

## 3. Order lifecycle / state machine

Exact `OrderStatus` enum (verbatim, no invented states):

```
PENDING_PAYMENT | PAID | PROCESSING | READY_FOR_DISPATCH | SHIPPED | DELIVERED | CANCELLED | REFUNDED
```

### Transition table (Phase 6 buildable vs. deferred)

| From | To | Trigger | Actor type | Buildable in Phase 6? |
|---|---|---|---|---|
| *(none)* | `PENDING_PAYMENT` | Order created | `SYSTEM` (actorId = customer's userId, or null for guest) | **Yes** — `createOrder` |
| `PENDING_PAYMENT` | `CANCELLED` | Customer or admin cancels before payment | `SYSTEM` (customer, actorId = their id) or `ADMIN` (actorId = admin's id) | **Yes** — `cancelOrder` |
| `PENDING_PAYMENT` | `PAID` | Verified payment success | `WEBHOOK` (actorId = null) | Primitive only — `markOrderPaid(orderId, paymentAttemptId)`, an inter-module contract with no actor, exactly mirroring Inventory's `completeInventorySale` shape. The *caller* (a future Payment webhook worker) does not exist yet. |
| `PAID` → `PROCESSING` → `READY_FOR_DISPATCH` → `SHIPPED` → `DELIVERED` | (forward fulfillment chain) | Admin/staff fulfillment actions | `ADMIN` | **Not built in Phase 6** — no fulfillment UI/use-case exists yet; the state machine function must *know* these are valid transitions (so it never accidentally forbids them later), but no use-case calls them in this phase. |
| `PAID`/`PROCESSING`/`READY_FOR_DISPATCH`/`SHIPPED`/`DELIVERED` | `REFUNDED` | Confirmed refund processed | `ADMIN` or `WEBHOOK` | **Not built in Phase 6** — depends on the Refund/Payment module. |
| `PAID` | `CANCELLED` | Admin cancels an already-paid order (refund flow) | `ADMIN` | **Not built in Phase 6** — this transition's correctness depends on *also* triggering a refund, which requires Paystack/Refund machinery this phase explicitly excludes. Flagged in §25, not silently included. |
| `CANCELLED` | `PAID` | *(a late webhook arriving after cancellation)* | — | **Explicitly forbidden, always.** See §11. |
| Any terminal state | anything else | — | — | Forbidden — `DELIVERED`/`CANCELLED`/`REFUNDED` are terminal for Phase 6's purposes (fulfillment-side re-openings, if ever needed, are a future decision). |

### Where the state machine lives

`docs/ARCHITECTURE.md` §8 illustratively names this
`src/modules/orders/domain/order-state-machine.ts` (plural "orders").
**This plan uses `src/modules/order/` (singular)**, deliberately deviating
from that illustrative name, to match the established convention every
real module in this repository actually uses (`src/modules/catalog`,
`src/modules/inventory`, `src/modules/auth` — all singular). The
illustrative doc predates the convention Phase 3/4/5 actually settled on;
grounding in the real repository, per this plan's own instructions, means
following the real convention over the older illustrative name.

`order-state-machine.ts` is a pure function:

```ts
function nextState(current: OrderStatus, event: OrderTransitionEvent): OrderStatus
// throws ValidationError if the transition is not in the allowed table above
```

— zero I/O, unit-testable without a database (`domain/` layer, per the
ESLint `boundaries/dependencies` rule: `domain` cannot import `repo`, so
this function never touches Prisma).

### Actor-type mapping (resolving the "no `CUSTOMER` enum value" question, §1)

Since `OrderStatusHistoryActorType` has only `SYSTEM`/`ADMIN`/`WEBHOOK`:

| Real-world actor | `actorType` | `actorId` |
|---|---|---|
| Customer creates their own order (checkout) | `SYSTEM` | Customer's `userId`, or `null` for guest |
| Customer cancels their own order | `SYSTEM` | Customer's `userId` |
| Admin/staff cancels an order | `ADMIN` | Admin's `userId` |
| Future payment webhook transitions to `PAID` | `WEBHOOK` | `null` |
| Future TTL-sweep job cancels an abandoned order | `SYSTEM` | `null` |

`actorType` classifies *what kind of process* performed the transition;
`actorId` (nullable) additionally identifies *which user*, when one exists.
This mapping is stated explicitly here because the schema's naming does not
spell it out, and an implementer guessing at it later could reasonably
diverge — this is the approved reading.

Every transition writes exactly one `order_status_history` row, inside the
same transaction as the `orders.status` write (§7). History is never
overwritten (no `updatedAt` on the model — append-only by construction).

---

## 4. Immutable snapshot design

Covered precisely in §2 (order_items) and §14 (addresses). Summary
principle, confirmed against `docs/ARCHITECTURE.md` §3: **orders store
snapshots, not FK-only references.** No column this plan needs is missing
from the approved schema — no invented columns anywhere in this document.

---

## 5. Order creation transaction

### Pre-transaction (plain reads via `db`, not `tx` — no lock needed)

1. Resolve current `ProductVariant`/`Product` rows for every requested line
   (price, SKU, name, variant label, `status: ACTIVE`, `isDefault` not
   required). This is a plain read — there is no invariant requiring the
   price to be frozen between this read and the transaction; the price
   *at the moment of this read* is, by definition, the correct one to
   snapshot. No `FOR UPDATE`, no `tx.` — a genuinely "first plain read
   inside the transaction would poison nothing" situation does not even
   arise, because nothing later in the transaction re-reads variant/product
   data at all (it's already been captured into local values before the
   transaction opens).
2. Validate every line: variant exists and is `ACTIVE`, quantity is
   positive with ≤3 decimal places (reusing the exact validation shape
   Inventory's `quantity.ts`/`positiveQuantitySchema` already established —
   Order's own `schema.ts` duplicates these small pure predicates rather
   than importing them, matching the Phase 4→Phase 5 "small deliberate
   duplication keeps modules independent" precedent).
3. **Fast, non-authoritative** availability pre-check via
   `inventoryRepo`'s existing public `getAvailableQuantity(variantId)` (no
   actor, already built, read-only) — purely to reject an obviously-doomed
   checkout *before* opening an expensive transaction. This is never the
   authoritative check; the guarded `UPDATE` inside the transaction (§6) is.
4. Compute totals server-side (§15) from the resolved prices — never from
   any client-submitted `unitPriceMinor`/`lineTotalMinor`/`subtotalMinor`/
   `totalMinor`/`discountMinor` field. If such fields are ever present in a
   request body, they are ignored, not merely "not trusted for
   authorization" — they must not even be read into the total-computation
   path.
5. Generate a candidate `orderNumber` (§21).

### Inside one transaction (`order/repo.ts`'s own `db.$transaction`)

```
BEGIN
  INSERT orders (status: PENDING_PAYMENT, computed totals, orderNumber, ...)
  INSERT order_items (one per line, using the pre-resolved snapshot values)
  INSERT order_addresses (shipping [+ billing if different], from validated input)
  FOR EACH order_item just created:
    inventoryRepo.reserveInventoryForNewOrderItem(tx, { orderItemId, variantId, quantity })
      → guarded UPDATE + INSERT inventory_movements (RESERVE)
      → throws ValidationError on insufficient stock ⟶ whole transaction rolls back
  INSERT order_status_history (fromStatus: '' or a sentinel, toStatus: PENDING_PAYMENT, actorType per §3)
COMMIT
```

This ordering (order + order_items **before** reservation) is not just a
design choice — it is **required** by the existing FK
(`inventory_movements.order_item_id → order_items.id`): a `RESERVE`
movement cannot reference an `order_items` row that doesn't exist yet.
This directly resolves Scenario B (§20): "inventory reservation succeeds,
order creation fails" **cannot occur as a real interleaving in this
design**, because reservation is structurally impossible before the order
item exists. Scenario A (order created, reservation fails) is the only
real ordering, and rolls back cleanly because both writes are one
transaction.

No `payment_attempts` row is created here — that is a separate, later step
a future Payment module performs against the newly `PENDING_PAYMENT`
order (§8).

### Atomicity guarantee (restated precisely, for the implementation to prove)

Order creation and initial inventory reservation are **one** atomic
transaction. This plan's design guarantees, and implementation must verify
against real MySQL (§7's rollback-proof test, §23):

- **If any line's reservation fails** (insufficient stock): no `orders`
  row, no `order_items` rows, no `order_addresses` rows, no reservation,
  no `order_status_history` row survive. All roll back together.
- **If the transaction fails for any reason after a reservation succeeded
  but before `COMMIT`** (a crash, a thrown error in a later step, a
  connection loss): all inventory writes **and** all order writes roll
  back together — there is no code path in this design where one commits
  without the other, because they are statements inside the same
  `db.$transaction(...)` call, never two separate transactions coordinated
  by application-level "best effort" cleanup.
- **This is not merely asserted** — §7's mandatory rollback-proof test
  (a deliberate failure injected after the inventory reservation step and
  before the final commit) is the actual verification implementation must
  produce, inspecting the database directly afterward to confirm zero
  partial state, exactly like every concurrency proof Phase 4/5 already
  established as this codebase's bar.

---

## 6. Inventory reservation integration

Order's creation transaction calls one **new, additive** Inventory repo
primitive per line item — see §7 for exactly what "new" means and why it
does not modify Phase 5.

Quantity passed to `reserveInventoryForNewOrderItem` is **exactly** the
`order_items.quantity` value just inserted for that line — never
independently re-derived, matching the existing `reserveInventory`
contract's own invariant (`orderItem.quantity.equals(data.quantity)`,
confirmed in Phase 5's `repo.ts`).

---

## 7. Transaction composition strategy — the central design decision

### The problem, precisely

Inventory's three existing exported functions
(`reserveInventory`/`releaseInventory`/`completeInventorySale`,
`src/modules/inventory/repo.ts`) each unconditionally open and fully own
their **own** `db.$transaction(...)`. As written today, they are **not
composable** into an externally-supplied transaction: calling
`inventoryRepo.reserveInventory(...)` from inside Order's own
`db.$transaction(...)` would run it as a **second, independent**
transaction against the shared Prisma connection pool — meaning order
creation and inventory reservation would **not** commit or roll back
together, directly violating the required invariant ("Order creation and
initial inventory reservation must commit or roll back atomically").

This exact gap was identified and explicitly deferred by Phase 5's own
plan (`docs/PHASE_5_INVENTORY_PLAN.md` §15): *"Cross-module transaction
composition is deliberately left as an open question... resolving it
wrongly here — e.g., by having `reserveInventory` accept a
`Prisma.TransactionClient` parameter, which would leak a `@prisma/client`
type into whatever layer holds and passes that client — risks quietly
weakening a boundary rule."* This plan is where that question gets
resolved.

### The precise boundary: what "Phase 5 is not modified" means here

This plan requires **one** change to Phase 5's files, and states exactly
what kind of change it is, rather than leaving "unmodified" and "requires a
change to `repo.ts`" in silent contradiction:

- **Unchanged**: every existing exported function's name, signature, and
  observable behavior in `src/modules/inventory/repo.ts` and every other
  Phase 5 file. Every existing Phase 5 unit/integration/concurrency/e2e
  test continues to pass, unmodified, without alteration to its
  assertions.
- **Unchanged**: `prisma/schema.prisma`, all Inventory migrations, all
  Inventory API routes, all Inventory use-cases, all Inventory permissions.
- **Additive only**: `src/modules/inventory/repo.ts` gains **new, private
  helpers plus three new exported functions** (§7 below) that did not
  exist before. This is infrastructure Phase 6 needs to compose a
  transaction across module boundaries — it does not redesign, replace, or
  change the meaning of anything Phase 5 already shipped. The distinction
  is the same one this codebase already applies to every additive
  extension of an existing file (e.g. Phase 5 itself added new exports to
  files without "modifying" what earlier phases had approved there).
- **Required in the implementation report**: `docs/PHASE_6_ORDER_IMPLEMENTATION.md`
  must explicitly list every new export added to `inventory/repo.ts` under
  its own heading — e.g. "Phase 6 transaction-composition infrastructure
  (additive to Phase 5)" — separate from anything Order-module-native, so
  a reviewer can immediately see that Phase 5's own surface was extended,
  never altered.

### The three options, evaluated against the actual ESLint boundary rules

The current `boundaries/dependencies` config (`eslint.config.mjs`, quoted
in full during grounding) disallows:
- `repo` files from importing `use-case`/`presentation`/`component`/`domain`/`job` **elements**.
- It does **not** list `repo` (a file *category*, not an element *type*)
  anywhere in any `disallow.to` clause — meaning **a `repo.ts` file
  importing another module's `repo.ts` file is not blocked by the existing
  rule**, confirmed by direct reading of the rule's structure, not assumed.

**Option A — Order's repo owns the transaction, calls an Inventory repo
primitive that accepts the same `Prisma.TransactionClient`.** This is
**ESLint-legal today**, requires no new lint rule, and confines the
`Prisma.TransactionClient` type to two `repo.ts` files — never a use-case,
never presentation. **Chosen.**

**Option B — a shared, framework-agnostic transaction abstraction
(neither module's repo imports the other's; both compose through a new
opaque `TransactionContext`).** Architecturally the "purest" long-term
answer, but it requires **modifying Phase 5's already-approved, tested
`repo.ts`** to accept the new abstraction instead of calling
`db.$transaction` directly — in direct tension with this phase's explicit
"Do NOT modify Phase 5" instruction. It would also require building new
shared infrastructure (e.g. `lib/transaction.ts`) with no current
precedent, a materially larger and riskier change than this phase's scope
justifies. **Rejected for Phase 6**, noted as a legitimate future
refactor if a *third* module later needs the same composition (at which
point the pattern would be proven twice, not hypothesized once).

**Option C — Order's repo runs a batch of Inventory-provided operations
via Prisma's non-interactive `tx.$transaction([...])`.** Does not fit:
Inventory's guarded-UPDATE-then-conditional-INSERT logic requires
JavaScript-level branching (checking `result.count`, conditionally
throwing) between statements, which Prisma's array-batch transaction API
cannot express. **Rejected** — not a real fit for the existing logic
shape, not merely a style preference.

### What Option A concretely requires (to be built when Order is implemented, not now)

**Phase 5's existing public API is not modified in any observable way** —
same exported function names, same signatures, same behavior, same passing
tests. What gets added, additively, inside `inventory/repo.ts`:

1. The existing bodies of `reserveInventory`/`releaseInventory`/
   `completeInventorySale` get their core guarded-UPDATE-then-INSERT logic
   extracted into private helpers that accept a `tx: Prisma.TransactionClient`
   parameter (Prisma is already imported in this file — nothing new crosses
   the Prisma-import boundary that doesn't already). The existing public
   functions become thin wrappers: open `db.$transaction`, call the private
   helper with the resulting `tx`, keep their existing idempotency
   fast-path/guard-failure-recheck behavior exactly as today.
2. **One new export for order creation specifically**:
   `reserveInventoryForNewOrderItem(tx, { orderItemId, variantId, quantity })`.
   This is a **structurally simpler** primitive than the general-purpose
   `reserveInventory`: because it is only ever called with a
   **just-created, never-before-used** `orderItemId` (order creation always
   inserts fresh `order_items` rows), the dedup-key collision
   `reserveInventory`'s idempotency machinery exists to handle **cannot
   occur** here — a brand-new order_item id has never had a RESERVE
   movement before. This primitive therefore needs only: the
   order-item/variant match check (still enforced, defense-in-depth, same
   as always), the guarded `UPDATE`, and the movement `INSERT` — no
   fast-path check, no guard-failure existing-movement recheck, because
   there is nothing to recover from at a fresh id. This sidesteps the
   hardest open question entirely (see next point).
3. **Two new exports for cancellation/payment-success composition**:
   `releaseInventoryInTransaction(tx, { orderItemId })` and
   `completeSaleInTransaction(tx, { orderItemId })`. Unlike #2, these
   **do** need idempotency (an admin double-clicking "cancel," a webhook
   delivered twice), but they achieve it via an **explicit pre-check, not
   a caught constraint violation**: each function's first action is a
   `db.inventoryMovement.findFirst(...)` (via `db`, not `tx` — reusing
   Phase 5's own already-validated snapshot-poisoning fix, since Order's
   transaction may have already done other plain reads before reaching
   this call, which would fix its REPEATABLE READ snapshot before this
   point) checking whether the target movement already exists; if so,
   return it immediately as a no-op signal, performing **no** write in
   this call at all. If not found, proceed with the guarded `UPDATE` +
   `INSERT` using `tx`.

   This design **deliberately avoids** relying on catching a MySQL
   constraint-violation error mid-way through an already-open, externally
   owned transaction and then continuing to use that same transaction for
   further statements — whether that pattern is even safe in Prisma/MySQL
   has not been tested anywhere in this codebase, and this plan does not
   assume an untested mechanic. The pre-check-and-skip approach needs no
   such assumption: it only ever performs ordinary conditional reads/writes,
   never catches-and-continues after a failed statement inside a shared
   transaction.

### Explicit flag: this composition must be empirically verified during implementation

Exactly the rigor Phase 4/5 applied to Prisma error shapes and MySQL
snapshot behavior must be applied here too: **before this design ships**,
implementation must include a real, repeatable integration test that
kills/fails the transaction *after* a successful inventory step but
*before* the final `order_status_history` insert, and confirms the entire
transaction — including the inventory `UPDATE`/`INSERT` — rolled back
completely. This plan asserts the design *should* work per Prisma's
documented interactive-transaction semantics; it does not assert this has
already been proven in this codebase, and implementation must prove it,
not assume it.

---

## 8. Payment boundary

Unchanged from the already-approved architecture (`docs/PHASE_5_INVENTORY_PLAN.md`
§16, `docs/ARCHITECTURE.md` §6.1/§6.2): `payment_attempts` is 1:N off
`orders`; `orders.authoritative_payment_attempt_id` is a nullable,
`@unique` pointer set **exactly once**, only when some attempt reaches
`SUCCESS`.

### The payment-attempt ownership invariant (required correction)

The existing schema guarantees `orders.authoritative_payment_attempt_id →
payment_attempts.id` (a real FK) — it does **not** guarantee that
`payment_attempts.order_id = orders.id` for whatever `orderId` a caller
happens to pass alongside a given `paymentAttemptId`. This is, precisely,
the **same bug shape** Phase 5's mandatory correction addressed for
`inventory_movements.order_item_id → order_items.id`
(`docs/PHASE_5_INVENTORY_IMPLEMENTATION.md` §6): a foreign key proves the
referenced row *exists*, never that it names the *correct* other row. An
implementation that trusted `markOrderPaid(orderId, paymentAttemptId)`'s
two arguments to already be consistent could mark Order A `PAID` using a
payment attempt that actually belongs to Order B — a caller bug or a
forged input would silently succeed.

**Fix**: a new private helper in `order/repo.ts`,
`requireMatchingPaymentAttempt(orderId, paymentAttemptId)` — named and
shaped after Phase 5's `requireMatchingOrderItem` precedent — runs first,
before any write, and enforces the relational invariant explicitly:

1. The payment attempt exists (`NotFoundError` if not).
2. The payment attempt's `orderId` equals the supplied `orderId`
   (`ValidationError` — "This payment attempt does not belong to the
   specified order" — if not; **no order or inventory mutation occurs**).
3. The payment attempt's `status` is `SUCCESS` (`ValidationError` if not —
   `markOrderPaid` must never transition an order to `PAID` on the
   strength of an `INITIATED`/`PENDING`/`FAILED`/`ABANDONED`/
   `INITIALIZATION_FAILED` attempt).
4. Only after 1–3 pass does the conditional `UPDATE` (below) even run,
   itself re-checking that the order is still `PENDING_PAYMENT`.
5. Only if the conditional `UPDATE` succeeds does the order become `PAID`
   and the payment attempt become authoritative.

This check reads `payment_attempts.orderId` and `.status` — both
effectively immutable for this purpose (a payment attempt's `orderId` is
set once at creation and never updated by any code path; its transition to
`SUCCESS` is a one-way, terminal fact the calling Payment module has
already independently verified via Paystack before ever invoking
`markOrderPaid` — Order's check here is a defense-in-depth relational
guard, not a race-sensitive read). It is therefore safe to perform via a
plain read before or as the first statement inside the transaction,
without the snapshot-poisoning concerns that apply to *mutable, actively
contended* fields like `inventory_items.quantity_reserved`.

**This invariant is distinct from, and does not replace, §12's
double-payment handling.** §12 covers two *genuinely different, both
legitimately-belonging-to-this-order* attempts racing to become
authoritative — resolved by the conditional `UPDATE` + the `@unique`
constraint on `authoritative_payment_attempt_id`, unchanged by this
correction. This section's new check instead prevents a *mismatched*
attempt (belonging to a different order, or not actually successful) from
ever being considered in the first place. The two mechanisms compose: a
call must first pass the ownership/status check (this section), and only
attempts that pass it ever reach the exactly-once race resolved by §12.

### `markOrderPaid` — revised design

**Order's Phase 6 contribution to this boundary**: one inter-module
contract function, `markOrderPaid(orderId, paymentAttemptId)` — no actor,
no permission check, no HTTP route, exactly matching the shape of
Inventory's `completeInventorySale({ orderItemId })` (no actor, called by a
future authorized caller, Zod-validated at the boundary regardless). Its
body:

```
requireMatchingPaymentAttempt(orderId, paymentAttemptId)   // steps 1-3 above, throws before any write

BEGIN (order/repo.ts's own transaction)
  UPDATE orders SET status = 'PAID', authoritative_payment_attempt_id = :paymentAttemptId
    WHERE id = :orderId AND status = 'PENDING_PAYMENT'
  IF count == 0:
    -- Already PAID (§12), or CANCELLED (§11), or some other state.
    -- Return a clear "did not transition" signal; do NOT throw a generic error
    -- and do NOT proceed to any inventory action.
  ELSE:
    FOR EACH order_item ON this order:
      inventoryRepo.completeSaleInTransaction(tx, { orderItemId })
    INSERT order_status_history (PENDING_PAYMENT -> PAID, actorType: WEBHOOK)
COMMIT
```

### Atomicity guarantee for `markOrderPaid` (restated precisely)

- **Successful transition**: `PENDING_PAYMENT` → verify the payment
  attempt belongs to this order and is `SUCCESS` (this section) → the
  conditional `UPDATE` to `PAID` → `authoritative_payment_attempt_id` set
  → `RESERVE → SALE` for every line, inside the same transaction → the
  `PAID` history row inserted → `COMMIT`. If **any** part after the
  conditional `UPDATE` fails, the **entire** transaction — including the
  status write and every completed `SALE` conversion — rolls back; the
  order is left exactly as it was before the call (still `PENDING_PAYMENT`,
  still reserved, not sold).
- **Racing successful attempts** (§12, unchanged): only one becomes
  authoritative — the conditional `UPDATE` plus the `@unique` constraint
  on `authoritative_payment_attempt_id` guarantee this regardless of how
  many genuinely-belonging, genuinely-`SUCCESS` attempts race.
- **Order already `CANCELLED`** (§11, unchanged): `CANCELLED → PAID` is
  rejected by the conditional `UPDATE` observing 0 rows affected; the order
  is never resurrected to `PAID` under any circumstance.
- **Order already `PAID`** (§12, unchanged): the second call returns a
  distinguishable `{ transitioned: false, order }` result and does not
  re-run `SALE` conversion a second time (Inventory's own
  `completeSaleInTransaction` is additionally idempotent per-item, §7 —
  a second layer of protection even if `markOrderPaid` were somehow
  called twice against an order that had *just* transitioned).

Order **never** calls Paystack, never reads a `payment_attempts` row's
fields beyond what §8's ownership check needs (`orderId`, `status`), and
never inspects webhook payloads — identical boundary discipline to
Inventory's own (`docs/PHASE_5_INVENTORY_IMPLEMENTATION.md` §11).

---

## 9. Payment retry semantics

Per `docs/ARCHITECTURE.md` §9: *"Retry Payment" re-enters at step 6 only —
it creates a new `payment_attempts` row against the existing order and
skips steps 1–5 entirely (no re-reservation, no new order)*.

**Order module needs no dedicated "retry" use-case at all.** A retry is
entirely a future Payment module operation: it looks up the existing
`PENDING_PAYMENT` order (via Order's already-planned `getOrderById`, §19)
and inserts a new `payment_attempts` row against it directly, on its own
table, with its own repo — Order's reservation (made once, at order
creation) is untouched, exactly because reservation belongs to the order,
not to any one payment attempt (the premise this entire phase is built
on).

---

## 10. Cancellation semantics

**Who can cancel — adopted for this phase (no longer an open question)**:
a customer **may** cancel their own `PENDING_PAYMENT` order, provided all
of the following hold, each already designed precisely elsewhere in this
plan and restated here as the concrete acceptance conditions:

- **Ownership is verified** — `order.userId === actor.id` (§16/§17), the
  same ownership check every other customer-facing order operation uses.
- **The order is still `PENDING_PAYMENT`** — enforced by the conditional
  `UPDATE`'s own `WHERE` clause (below); no other source state is
  cancellable by a customer.
- **Inventory reservation is released atomically** — `releaseInventoryInTransaction`
  is called for every line, inside the same transaction as the
  `orders.status` write (below), never as a separate best-effort step.
- **Status history is recorded** — one `order_status_history` row per
  cancellation, `actorType: SYSTEM`, `actorId`: the customer's own
  `userId` (§3's actor-mapping table).
- **Cancellation is idempotent** — the guard-failure recheck (below)
  ensures a duplicate cancel call (e.g. a double-clicked button) never
  errors once the desired end state (`CANCELLED`) already holds.

**No new permission is added for this** — customer self-cancellation is
authorized purely by ownership, exactly like a customer reading their own
order (§16); it does not use, and does not need, `orders.update` (that
permission continues to gate **admin/staff** cancellation of *any* order,
unchanged).

**Which states**: only `PENDING_PAYMENT → CANCELLED` is built in Phase 6.
`PAID → CANCELLED` (the admin-refund-flow transition named in
`docs/ARCHITECTURE.md` §8's lifecycle diagram) is **explicitly not built**
in this phase — correctly triggering it requires initiating a refund,
which requires Paystack/Refund machinery this phase must not touch. The
state machine (§3) is aware this transition exists in principle (so a
later phase doesn't have to fight it), but no use-case in Phase 6 reaches
it. Flagged in §25.

**Mechanism** (mirrors §8's conditional-UPDATE shape exactly):

```
BEGIN (order/repo.ts's own transaction)
  UPDATE orders SET status = 'CANCELLED' WHERE id = :orderId AND status = 'PENDING_PAYMENT'
  IF count == 0:
    -- Re-read current status. If it's already CANCELLED, treat this call as
    -- an idempotent success (the desired end state already holds) —
    -- exactly the guard-failure-recheck pattern Phase 5 established.
    -- If it's anything else (PAID, etc.), this is a genuine conflict:
    -- throw ConflictError("This order can no longer be cancelled.").
  ELSE:
    FOR EACH order_item ON this order:
      inventoryRepo.releaseInventoryInTransaction(tx, { orderItemId })
    INSERT order_status_history (PENDING_PAYMENT -> CANCELLED, actorType per §3, note)
COMMIT
```

**Idempotency**: covered by the guard-failure recheck above (order-level)
and by `releaseInventoryInTransaction`'s own pre-check (item-level, §7) —
two independent layers, matching the "belt-and-suspenders" precedent
Phase 5 set for the order-item/variant mismatch guard.

**TTL sweep** (`docs/ARCHITECTURE.md` §7's "scheduled job cancels orders
stuck in `PENDING_PAYMENT` past a TTL"): the *use-case* this plan builds
(`cancelOrder`) is designed to be safely callable by such a job later
(actor type `SYSTEM`, `actorId: null`) — but the job itself, and any
`src/jobs/*` scheduling infrastructure, is **not** built in Phase 6. No
job-runner decision has been made anywhere in this codebase yet; inventing
one here would be out of scope. Flagged in §25.

---

## 11. Late payment success handling

Scenario: an order is cancelled, then a `charge.success` webhook for one of
its (now-irrelevant) payment attempts arrives late.

The state machine (§3) makes `CANCELLED → PAID` an explicitly forbidden
transition — not silently allowed, not silently ignored. Concretely, this
falls out of §8's `markOrderPaid` mechanism directly: its conditional
`UPDATE ... WHERE status = 'PENDING_PAYMENT'` finds the order already
`CANCELLED`, affects 0 rows, and `markOrderPaid` returns `{ transitioned:
false, order }` rather than throwing or silently succeeding. **The order is
never resurrected to `PAID`.** The future Payment module's responsibility,
on seeing `transitioned: false` where the order status is specifically
`CANCELLED` (not merely "already PAID," a different and expected outcome —
see §12), is to route that payment to a manual reconciliation path (refund
the customer for a sale that no longer exists) — this is explicitly a
Payment-module/operational concern (`docs/ARCHITECTURE.md` §19's
mitigation: *"route any CANCELLED-order charge.success event to a manual-
reconciliation queue instead of silently dropping or silently re-accepting
it"*), not something Order module builds machinery for beyond returning an
honest, distinguishable result.

---

## 12. Double-payment reconciliation

Scenario: two payment attempts for the same order both receive verified
success (e.g. a genuine race, or a customer paying twice by mistake).

`markOrderPaid`'s conditional `UPDATE ... WHERE status = 'PENDING_PAYMENT'`
plus the `@unique` constraint on `orders.authoritative_payment_attempt_id`
guarantee **exactly one** attempt can ever become authoritative — the
second's identical call affects 0 rows, returns `{ transitioned: false,
order }` where `order.status` is already `PAID` (distinguishable from the
`CANCELLED` case in §11 by checking `order.status` in the result, not by a
different exception type). Per `docs/DATABASE_DESIGN.md` §22, quoted in
full in §1: this is as far as the schema/Order-module logic can or should
go — it "cannot make the *business* problem of a genuine double-charge
disappear," and resolving that (issuing an actual refund for the losing
attempt) is an operational/observability concern for a later phase, not
something this plan pretends to solve with a database constraint alone
(per the brief's own explicit instruction not to pretend that).

**Order module's precise, bounded responsibility**: implement the
conditional `UPDATE` correctly, and always return a result the caller can
act on (`transitioned: false` + current order state) rather than an
ambiguous error that collapses "already paid" and "cancelled" and "some
other conflict" into one undifferentiated failure.

---

## 13. Order idempotency

| Operation | Idempotency mechanism | Gap? |
|---|---|---|
| Order creation (`createOrder`) | **None, by design.** No schema field exists for a client-supplied idempotency key on `orders`. Per `docs/DATABASE_DESIGN.md` §22: *"the checkout use-case should check for an existing PENDING_PAYMENT order tied to the same cart before creating a second one — flagged as an application-layer recommendation for Phase 8, not a schema-level fix."* **Flagged explicitly**, not silently solved: `createOrder` in Phase 6 will create a new order on every call. Deduplicating "did the customer already check out this cart" is Cart/Checkout's job in a future phase (Order has no `Cart` dependency in Phase 6 to even perform that check against). |
| Cancellation (`cancelOrder`) | Guard-failure recheck (§10) — idempotent. |
| `markOrderPaid` | Conditional UPDATE + explicit `transitioned` result (§8/§11/§12) — idempotent, distinguishable outcomes. |
| `markOrderPaid`'s payment-attempt ownership check | Not an idempotency mechanism — a relational-integrity guard (§8) rejecting mismatched `orderId`/`paymentAttemptId` pairs before any write, independent of and prior to the idempotency handling above. |
| Inventory reservation (order creation) | Not needed — see §7 point 2 (fresh `order_item_id`, collision structurally impossible). |
| Inventory release/sale (cancellation/payment) | Pre-check-and-skip (§7 point 3) — idempotent. |
| Payment retry | Not Order's concern (§9) — a new `payment_attempts` row every time, by design. |

No generic idempotency-key table is invented, per the explicit instruction
not to unless the schema already supports it — it does not, and the one
place a real gap exists (order-creation dedup) is a named, deferred, future
Checkout-layer responsibility already documented in the approved
architecture, not something Phase 6 needs to (or can, without a `Cart`
dependency) solve.

---

## 14. Customer address snapshot

Already resolved by the existing schema — no gap. `order_addresses` is a
complete, independent copy (§1), never referencing `addresses` by FK.
`createOrder`'s input for shipping/billing address is plain validated data
(full name, phone, address lines, city, state, country, postal code) —
whether that data originated from a customer picking a saved `Address` row
or typing a new one is irrelevant to Order module: either way, the
resolved field values are copied into `order_addresses` at creation time,
and a later edit/delete of any saved `Address` row can never affect the
historical order. No STOP condition applies here.

---

## 15. Order totals / money

**Server-authoritative, computed once, never trusted from the client**:
`unitPriceMinor`, `productNameSnapshot`, `skuSnapshot` etc. are resolved
from the database (§5); `clientPrice`/`clientTotal`/`clientDiscount`-shaped
fields, if present in a request body, are never read into any
total-computation path (not merely "ignored for authorization" — structurally
absent from the Zod input schema for `createOrder`, so they can't even
reach the use-case as typed input).

**The exact, DB-enforced formula** (`chk_orders_total_arithmetic`, §1):

```
total_minor = subtotal_minor - discount_minor + delivery_fee_minor + tax_minor
```

### Resolved formula (no longer an open question)

The schema's own field structure disambiguates this without inventing a
pricing engine: `order_items` carries **line-level** `discountMinor`/
`taxMinor` (a per-line markdown/tax, independent of any order-wide
coupon), while `orders` carries **order-level** `discountMinor`/`taxMinor`
(a single coupon-driven discount and a single flat tax figure for the
whole order) — these are two different concepts sharing similar names, not
one value duplicated in two places. `CouponRedemption.discountAppliedMinor`
is itself already a *resolved snapshot amount* (exactly like
`order_items.unitPriceMinor` is a resolved snapshot, not a formula to
re-derive) — its value simply **is** `orders.discountMinor` when a coupon
was redeemed. This fixes the formula exactly:

1. **Per line**: `lineTotalMinor = round(unitPriceMinor * quantity) -
   order_items.discountMinor + order_items.taxMinor`. **For Phase 6,
   `order_items.discountMinor` and `order_items.taxMinor` are always `0`**
   — no per-line discount/tax feature is built in this phase (the columns
   exist in the schema for a possible future feature; Phase 6 does not
   populate them beyond their default). Rounding rule: round-half-up to
   the nearest kobo, applied once per line (an application decision the
   schema deliberately leaves open, per `docs/DATABASE_DESIGN.md` §7's
   note that no CHECK ties `lineTotalMinor` to the raw product because
   `quantity` is `DECIMAL`).
2. **`subtotalMinor` = `sum(lineTotalMinor across all lines)`** — computed
   entirely from line totals, which (per point 1, for Phase 6) already
   exclude any order-level effect, since line-level discount/tax is always
   zero and the order-level coupon discount is applied *after* summing, in
   the next step. This is unambiguously "before order-level discount,"
   because there is nothing else it could mean once line-level
   discount/tax is pinned at zero.
3. **`orders.discountMinor` = `CouponRedemption.discountAppliedMinor`** if
   exactly one `CouponRedemption` row exists for this order (schema-
   enforced to be at most one: `CouponRedemption.orderId` is `@unique`),
   else `0`. Phase 6 does not build coupon *code validation/redemption*
   logic (looking up a `Coupon` by code, checking `usageLimit`/`startsAt`/
   `expiresAt`, computing the FLAT/PERCENTAGE discount amount) — only this
   field's fixed, now-unambiguous position in the total formula. Wiring an
   actual coupon-redemption use-case is out of scope unless explicitly
   requested in a later phase; for Phase 6, `orders.discountMinor` is
   always `0` in practice, since no code path creates a
   `CouponRedemption` row yet.
4. **`deliveryFeeMinor`, `orders.taxMinor`** — flat, server-computed
   values; no shipping-rate engine or tax-jurisdiction engine is built
   (the schema doesn't have columns for one, and none was asked for). For
   Phase 6's initial implementation both default to `0` unless a specific
   flat value is explicitly requested — the field and formula position are
   ready for a future feature to populate either without any schema or
   formula change.
5. **`totalMinor = subtotalMinor - orders.discountMinor + deliveryFeeMinor
   + orders.taxMinor`** — computed by this exact formula, guaranteed to
   satisfy `chk_orders_total_arithmetic` by construction, not by hoping
   the arithmetic happens to line up.

This is now a fully deterministic specification, not an implementation-time
decision — removed from open questions (§25).

**Totals are never recalculated after creation.** Cancellation does not
touch `orders`' money columns. `markOrderPaid` does not touch them either.
Any future refund workflow operates on `payment_attempts`/`refunds`'
own amount columns, never by mutating `orders.totalMinor` retroactively.

All arithmetic uses integer (`number`/`bigint` as appropriate — money
values comfortably fit `number` given the existing `INT UNSIGNED` ~42.9M
NGN ceiling noted in `docs/DATABASE_DESIGN.md` §19) — never floating-point
division for money. `quantity` arithmetic (for the `unitPriceMinor *
quantity` line-total step) uses `Prisma.Decimal`, matching Inventory's
exact established convention, converted to an integer minor-unit result
only at the final rounding step.

---

## 16. Authorization

**No new permission keys are required.** `prisma/seed-data.ts` already
seeds exactly what Phase 6 needs:

```ts
"orders.read",    // seeded to both `staff` and `super_admin`
"orders.update",  // seeded to both `staff` and `super_admin`
```

| Action | Authorization |
|---|---|
| Customer reads their own order(s) | `requireAuthenticatedUser` + ownership check (`order.userId === actor.id`) — **no permission check**, matching `customer` role's zero-permission design |
| Admin/staff reads any order | `orders.read` |
| Customer cancels their own `PENDING_PAYMENT` order | `requireAuthenticatedUser` + ownership check — no permission check |
| Admin/staff cancels any order | `orders.update` |
| `markOrderPaid` | No actor at all — inter-module contract (§8), matching Inventory's `completeInventorySale` |

Every check uses `requirePermission(actor, "orders.read"/"orders.update")`
or an explicit ownership comparison — never a role-name string comparison,
following the established Phase 3/4/5 convention exactly
(`src/modules/auth/use-cases/permissions.ts`'s `requirePermission`,
`lib/errors.ts`'s `ForbiddenError`/`UnauthorizedError`, quoted in full
during grounding).

**Explicit rejection of a generic status-mutation surface** (§23 of the
brief): there is no `updateOrderStatus(actor, orderId, { status })`
use-case and no route resembling `PATCH /orders/:id { status: "PAID" }`.
Every transition is its own named, narrowly-scoped function
(`cancelOrder`, `markOrderPaid`) that internally consults the state
machine (§3) for the *only* transition it is allowed to attempt — an admin
can never directly set `status: "PAID"` through any code path this plan
builds, `orders.update` notwithstanding. `PAID` is reachable **only**
through `markOrderPaid`'s conditional UPDATE, which no admin-facing
use-case calls (only the future Payment webhook worker would).

---

## 17. IDOR protection

Direct application of the established pattern (`tests/integration/idor.test.ts`,
`tests/integration/privilege-escalation.test.ts` precedent, not re-derived
here): every read/write use-case that isn't already `orders.read`/
`orders.update`-gated performs an explicit ownership check
(`order.userId === actor.id`) before returning any data — never relying on
"the client only asked for its own order ID," since a forged ID in the URL
is exactly what this class of test exists to catch.

**Planned tests** (§23): Customer A requesting Customer B's order → `404`
(matching the established convention of not leaking existence via a `403`
vs `404` distinction — to be confirmed against whichever convention
`tests/integration/idor.test.ts` already established for other resources,
not invented fresh here). Forged `userId`, forged `customerId`, forged
role/permissions (a plain-object forged actor, matching
`catalog-authorization.test.ts`'s established pattern), forged order
status, forged totals, forged payment status in a request body — none may
influence authorization or authoritative state, verified the same way
Phase 4/5 verified it (constructing the forged input directly and asserting
it has zero effect).

**Open question, not silently solved (see §25)**: guest orders
(`userId: null`) have no session identity to check ownership against at
all once the browser session that created them ends. There is no schema
field for a guest-order access token in `orders`/`order_addresses`. This
plan does not invent one — it flags that guest post-checkout order lookup
needs its own explicit design (likely order-number + contact-info
verification, with its own rate-limiting/enumeration-resistance
considerations) as a decision for the Cart/Checkout phase or an explicit
follow-up, not solved by Order module's ownership-check pattern, which
inherently assumes a session exists.

---

## 18. Auditability

`order_status_history` is the complete, sufficient trail for every status
transition (§3) — **no second order-audit table is created**, per the
explicit instruction. `actorType`/`actorId` distinguish customer, staff/
admin, and system/webhook actions per §3's mapping. The generic `audit_logs`
table (used by Inventory for `RESTOCK`/`ADJUSTMENT` in Phase 5) is **not**
used by Order module in Phase 6 — every order-relevant event Order module
produces already has a purpose-built home in `order_status_history`, so
writing a parallel `audit_logs` entry for the same event would be
redundant, unlike Inventory's restock/adjustment (which have no other
ledger at all besides `inventory_movements`, itself not a generic audit
trail).

---

## 19. Order queries

| Use-case | Actor | Scope |
|---|---|---|
| `createOrder(actor \| null, input)` | Optional (guest checkout allowed) | — |
| `getOrderById(actor, orderId)` | Required | Ownership, or `orders.read` |
| `getOrderByOrderNumber(actor, orderNumber)` | Required | Ownership, or `orders.read` — useful for a post-checkout confirmation redirect that only has the order number, not the numeric id |
| `listMyOrders(actor, pagination)` | Required | Own orders only (`userId = actor.id`) |
| `listOrdersForAdmin(actor, filters, pagination)` | Required | `orders.read` |
| `getOrderForAdmin(actor, orderId)` | Required | `orders.read`, full detail incl. status history |
| `cancelOrder(actor, orderId, note?)` | Required | Ownership (own `PENDING_PAYMENT` order) or `orders.update` |
| `markOrderPaid(orderId, paymentAttemptId)` | None — inter-module contract | — |

Pagination: **keyset**, reusing the exact convention Inventory/Catalog
already established (`(status/userId, createdAt)` composite cursor,
base64url-encoded, `decode` wrapped in try/catch returning `null` on
failure) — the existing `idx_orders_user_created`/`idx_orders_status_created`
indexes are the ones this pagination scheme is built against, not new
indexes this plan needs to request.

---

## 20. Concurrency strategy

**One uniform mechanism underlies every order-level concurrency scenario**:
a conditional `UPDATE orders SET status = :new WHERE id = :id AND status =
:expectedCurrent`, exactly mirroring `docs/ARCHITECTURE.md` §6.5's
already-approved pattern. MySQL takes an implicit exclusive row lock for
the duration of the `UPDATE`, released at `COMMIT`/`ROLLBACK` — whichever
transaction's `UPDATE` statement executes first wins; the loser's identical
`UPDATE` either blocks (if racing concurrently) until the winner commits,
then evaluates against the now-changed row and affects 0 rows, or observes
0 rows immediately if the winner already committed. This is the **same**
mechanism (guarded UPDATE, `result.count === 0` checked, guard-failure
triggers a recheck) Inventory already built and tested for
`inventory_items` — applied here to `orders` instead.

| Scenario | Locked row | Owning transaction | Loser's outcome |
|---|---|---|---|
| Two checkout requests reserving the same last unit | `inventory_items` row for that variant | Whichever Order transaction's reservation `UPDATE` (via `reserveInventoryForNewOrderItem`) runs first | The other's order creation transaction rolls back entirely (§7) — that customer sees "insufficient stock," not a corrupted order |
| Two attempts to cancel the same order | `orders` row | Whichever `cancelOrder` call's conditional `UPDATE` runs first | Guard-failure recheck (§10) — idempotent success if already `CANCELLED`, `ConflictError` if genuinely in a different state |
| Cancellation racing payment success | `orders` row | Whichever of `cancelOrder`'s or `markOrderPaid`'s conditional `UPDATE` runs first | The loser sees 0 rows affected and must reconcile per §11/§12 — never silently retries the write |
| Duplicate order creation (same conceptual checkout, two calls) | *(no lock exists for this — see §13)* | — | **Not solved at Order's layer** — explicitly deferred to Cart/Checkout (§13, §25) |
| Duplicate status transition (any) | `orders` row | Same conditional-UPDATE pattern uniformly | Guard-failure recheck, idempotent by construction |
| Payment success racing cancellation | Same as "cancellation racing payment success" above | — | — |
| Retrying the same order operation | Whichever row the operation's own guard checks | — | Idempotent recheck pattern, uniformly |

---

## 21. Order number / reference

No format is documented in the approved schema beyond `VarChar(30)` +
`@unique`. Proposed scheme (subject to approval, not yet implemented):
a date-based prefix plus a random alphanumeric suffix (e.g.
`ORD-20260808-7QK3F9`), generated pre-transaction, with the `INSERT`'s
`@unique` constraint as the real safety net — on the (extremely unlikely,
given a sufficiently long random suffix) collision, the transaction fails
cleanly and the caller regenerates and retries the whole `createOrder` call
from scratch (not just the number) for simplicity. **Not sequential,
not a raw incrementing integer** — a predictable customer-facing order
number would let one customer enumerate/guess at other customers' order
references, which is an IDOR-adjacent risk (§17) this plan avoids by
construction, not by relying on the authorization layer alone to catch it.

---

## 22. Admin status operations

Covered precisely in §16 ("no generic status-mutation surface") and §3.
Restated for emphasis, per the brief's explicit warning: **there is no
`transitionOrderStatus(actor, orderId, anyStatus)` function anywhere in
this plan.** `cancelOrder` is the only admin-facing status-mutation
use-case Phase 6 builds; it internally targets exactly one transition
(`PENDING_PAYMENT → CANCELLED`) via the state machine, never an
admin-supplied arbitrary target status. `PAID` is reachable only through
`markOrderPaid`, which no admin-facing code path calls.

---

## 23. Testing matrix

### Unit (`domain/` layer, no database)

- Order state machine: every documented transition (§3) allowed; every
  undocumented transition (especially `CANCELLED → PAID`) rejected.
- `domain/order-totals.ts`: line-total rounding, subtotal/discount/tax/
  total arithmetic satisfies `chk_orders_total_arithmetic`'s exact formula
  for a range of inputs including fractional-kobo edge cases.
- Quantity validation predicates (positive, ≤3 decimals, finite) —
  mirroring Inventory's `quantity.ts` test shape.
- Order-number generation format/uniqueness-probability reasoning (not a
  DB test — pure function).

### Integration (real MySQL, no mocks — matching every prior phase's
convention)

- Order creation: happy path (order + items + addresses + reservation all
  committed together); insufficient inventory (full rollback — Scenario A,
  verified via a fresh DB re-read showing **no** order/order_items/
  reservation row survives, not inferred from the promise rejecting);
  immutable snapshot values survive a later product/variant edit
  unchanged.
- Cancellation: happy path (status → `CANCELLED`, reservation → released,
  history row written); cancelling a non-`PENDING_PAYMENT` order rejected;
  duplicate cancellation idempotent.
- `markOrderPaid`: happy path; already-`PAID` duplicate call returns
  `transitioned: false` without re-running inventory sale conversion;
  `CANCELLED`-order call returns `transitioned: false` without resurrecting
  the order (§11). **Mandatory, mirroring Phase 5's own mandatory
  order-item/variant mismatch tests exactly** (§8):
  1. valid payment attempt genuinely belonging to the order + `SUCCESS` →
     transitions correctly;
  2. nonexistent `paymentAttemptId` → rejected, no mutation;
  3. a payment attempt that genuinely exists and is `SUCCESS` but belongs
     to a **different** order → rejected with `statusCode: 400`, confirmed
     via direct DB re-read that **neither** order's status changed and
     **no** inventory `SALE` movement was inserted for either order. This
     third case is mandatory, not optional, matching the exact rigor
     Phase 5's kickoff correction required for the analogous inventory
     bug shape.
  4. a payment attempt belonging to the order but not yet `SUCCESS` →
     rejected, no mutation.
- Customer order reads: own orders visible, another customer's order
  produces the established not-found/forbidden convention.
- Admin order reads: `orders.read` required; customer without it rejected.
- Authorization matrix: customer/staff/super_admin × every use-case in
  §19, mirroring `inventory-authorization.test.ts`'s structure exactly.
- IDOR: forged `userId`/role/permissions/status/totals/payment-status,
  mirroring `catalog-authorization.test.ts`'s forged-actor pattern and
  `idor.test.ts`'s established conventions.
- **Concurrency (mandatory, run 5+ consecutive times with zero flaky
  failures, per every prior phase's established bar)**:
  1. Two checkout requests for the last unit of the same variant.
  2. Two concurrent cancellation attempts on the same order.
  3. Cancellation racing `markOrderPaid` for the same order (both
     directions — cancel-wins and pay-wins).
  4. Duplicate `markOrderPaid` calls (simulating a redelivered webhook).
  5. The mandatory transaction-composition rollback proof from §7 (kill
     the transaction after the inventory step, before history insert;
     confirm zero partial state).
- **Database-cleanliness check** after every suite run, matching every
  prior phase's convention exactly (zero leftover test orders/order_items/
  order_addresses/order_status_history rows).

### E2E (minimal, real HTTP, no browser, no UI — matching Phase 4/5's
`request`-fixture-only convention)

- A minimal set of routes (exact list to be finalized at implementation
  time, following the "thin HTTP-boundary slice, not exhaustive
  business-rule re-coverage" principle Phase 4/5 already established) —
  e.g. create an order over HTTP, read it back, cancel it, confirm a
  forged status/total field in the request body has no effect (mirroring
  `tests/e2e/inventory.spec.ts`'s forged-field test exactly).

---

## 24. Implementation order

Derived from this plan's actual dependency structure, not copied from the
brief's illustrative sketch:

1. `domain/order-state-machine.ts`, `domain/order-totals.ts` (pure, zero
   I/O, unit-testable in isolation first).
2. `schema.ts` (Zod input shapes for every use-case in §19).
3. `types.ts` (safe DTOs + `CursorPage<T>`, matching Inventory's exact
   convention).
4. **The Inventory-side additive infrastructure extension from §7** (the
   three new tx-accepting repo primitives, plus the private helper
   extraction their existing public wrappers get refactored to call) —
   built and verified *before* Order's own repo needs them, with Phase 5's
   entire existing test suite (unit/integration/concurrency/e2e) re-run
   afterward to confirm zero regression in any existing behavior, contract,
   or test assertion (the same discipline Phase 5 itself applied whenever
   it touched anything shared). Documented explicitly as additive
   infrastructure in the implementation report, per §7's boundary
   statement — never described as "Phase 5 unmodified."
5. `order/repo.ts`: reads first (`findOrderById`, etc.), then
   `createOrder`'s transaction, then `cancelOrder`, then `markOrderPaid`.
6. Read use-cases (§19).
7. `createOrder`, `cancelOrder`, `markOrderPaid` use-cases.
8. Minimal API routes (exact list per §23's e2e scope).
9. Unit tests (can start as early as step 1).
10. Integration tests — happy paths first, then failure/authorization/IDOR,
    then the mandatory concurrency suite (§23) last, since it depends on
    everything above being correct first.
11. E2E tests.
12. Full verification suite (typecheck/lint/format/unit/integration/
    concurrency ×5+/e2e/production build/ESLint boundary re-test/security
    scan/database-cleanliness), matching every prior phase's bar exactly.
13. Implementation report (`docs/PHASE_6_ORDER_IMPLEMENTATION.md`),
    disclosing any deviations found during implementation, per the
    established convention.

---

## 25. Open questions (flagged, not silently decided)

1. **Order-creation deduplication** (§13, §20) — no mechanism exists or is
   built in Phase 6; explicitly deferred to Cart/Checkout, per the
   already-approved architecture's own deferral (`docs/DATABASE_DESIGN.md`
   §22).
2. **Guest order post-checkout lookup** (§17) — no session exists to check
   ownership against; needs its own design (likely order-number + contact
   verification with enumeration-resistance considerations) at Checkout
   time or as an explicit follow-up decision, not solved here.
3. **`PAID → CANCELLED` (admin refund-flow) transition** (§3, §10) — the
   state machine is aware it exists; no use-case in Phase 6 implements it,
   since correctness depends on Refund/Paystack machinery this phase
   excludes.
4. **TTL-sweep job** (§10) — the `cancelOrder` use-case is designed to be
   safely callable by such a job (actor type `SYSTEM`); no job-runner
   infrastructure decision has been made anywhere in this codebase, and
   none is proposed here.
5. **The Option A composition's actual atomicity** (§7) — asserted correct
   per Prisma/MySQL's documented interactive-transaction semantics; not
   yet empirically proven in this codebase. Implementation must include the
   explicit rollback-proof test named in §5/§7/§23 before this design is
   considered verified, not merely plausible.

**Resolved during review, no longer open**: the subtotal/discount formula
(§15 — fixed exactly, no ambiguity remains) and whether customer
self-cancellation is in scope (§10 — adopted, with explicit conditions).
Both are recorded here only as a changelog note, not as open items.

---

## 26. Acceptance criteria

This plan is ready for approval when:

- [ ] Every section above has been read and either approved or corrected.
- [ ] The chosen transaction-composition strategy (§7, Option A) is
      explicitly approved, including the precise boundary (§7's "what
      'Phase 5 is not modified' means here") between Phase 5's unchanged
      business behavior/public API/tests and the additive infrastructure
      extension required in `src/modules/inventory/repo.ts`.
- [x] The subtotal/discount formula (§15) is fully resolved — no longer an
      open question.
- [x] Customer self-cancellation (§10) is adopted with explicit conditions
      — no longer an open question, no new permission added.
- [ ] The `markOrderPaid` payment-attempt ownership invariant (§8) is
      explicitly approved — the requirement that `orderId`/`paymentAttemptId`
      relational correctness is verified inside Order's own transaction
      before any status/inventory mutation, independent of and prior to
      the existing double-payment race handling (§12).
- [ ] The order-number format proposal (§21) is approved or amended.
- [ ] No schema/migration change is requested — confirmed sufficient in §1.
- [ ] The mandatory rollback-proof test requirements (§5, §7, §23) — for
      both order creation and `markOrderPaid` — are acknowledged as
      required, unproven-until-implemented verification steps, not
      optional nice-to-haves.
- [ ] Explicit approval is given to proceed to implementation, following
      the hard stop this plan itself is bound by: no code, repo, use-case,
      migration, route, Server Action, UI, Cart, Checkout, Paystack
      integration, webhook, or refund logic exists yet, and none will be
      written until this document is approved.

# Phase 7 — Cart + Checkout Domain Implementation Plan

**Status: PLAN ONLY.** No code, migration, repository, use-case, route,
Server Action, UI, Paystack integration, webhook, refund, or payment
worker logic has been written. Phase 6 (Order)'s business behavior,
public API surface, and existing test suite remain unchanged by this
plan — no additive extension to Order/Inventory is implemented here
either; this plan only designs what would be needed (§16).

This plan is grounded entirely in the actual current repository state —
`prisma/schema.prisma`, `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`,
`docs/PHASE_6_ORDER_PLAN.md`, `docs/PHASE_6_ORDER_IMPLEMENTATION.md`, and
the existing Order/Inventory/Auth module source — read directly for this
plan. Every schema field, constraint name, and existing code convention
cited below was confirmed against the actual files, not assumed from this
brief's illustrative examples.

---

## 1. Actual cart schema analysis

The `carts`/`cart_items` tables already exist in full (migration
`20260808134322_commerce_domain`, the same migration that created
`orders`) — Phase 7 requires **no migration**. Confirmed sufficient; see
this section's own "Schema sufficiency verdict" subsection below for the
explicit verdict on each requirement this plan makes.

### `carts`

```prisma
model Cart {
  id             BigInt     @id @default(autoincrement()) @db.UnsignedBigInt
  userId         BigInt?    @map("user_id") @db.UnsignedBigInt
  guestTokenHash String?    @map("guest_token_hash") @db.Char(64)
  status         CartStatus @default(ACTIVE)
  expiresAt      DateTime?  @map("expires_at")
  createdAt      DateTime   @default(now()) @map("created_at")
  updatedAt      DateTime   @updatedAt @map("updated_at")

  activeCartUserKey  BigInt? @unique(map: "uq_one_active_cart_per_user") @map("active_cart_user_key") @db.UnsignedBigInt
  activeCartGuestKey String? @unique(map: "uq_one_active_cart_per_guest_token") @map("active_cart_guest_key") @db.Char(64)

  user  User?      @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  items CartItem[]

  @@map("carts")
}

enum CartStatus { ACTIVE  CONVERTED  ABANDONED }
```

- **`activeCartUserKey`/`activeCartGuestKey` are MySQL `GENERATED ALWAYS
  ... STORED` columns**, not plain columns: `CASE WHEN status = 'ACTIVE'
  THEN user_id/guest_token_hash ELSE NULL END`. This is what makes "one
  ACTIVE cart per identity, unlimited historical carts" actually true —
  confirmed by `docs/DATABASE_DESIGN.md` §6's own revision note: *"An
  earlier draft put a plain `UNIQUE` on `user_id`... that was actually
  stricter than intended... The fix... scopes uniqueness to `ACTIVE` rows
  only, the same generated-column technique already used for
  `product_variants.is_default` and `addresses.is_default`."*
- **CHECK constraint** `chk_carts_identity_exclusive` (migration SQL):
  `(user_id IS NOT NULL AND guest_token_hash IS NULL) OR (user_id IS NULL
  AND guest_token_hash IS NOT NULL)` — exactly one identity axis per row,
  always, DB-enforced.
- **`guestTokenHash` is `CHAR(64)`** — a fixed-length hex digest slot,
  matching `sessions.session_token_hash`'s and
  `verification_tokens.token_hash`'s exact shape (`@db.Char(64)`,
  `@unique`).
- **FK** `carts.userId → users.id` is `ON DELETE RESTRICT ON UPDATE
  RESTRICT` — a documented deviation from an originally-intended
  `CASCADE`, forced by MySQL error 1215 (no FK whose `ON DELETE` action is
  CASCADE/SET NULL/SET DEFAULT may target a column that feeds a `STORED`
  generated column in the same table — `userId` feeds
  `activeCartUserKey`). Same pattern already seen on `addresses.userId`.
- **No `@@index`** beyond the two unique generated-column indexes and the
  PK — no additional index is needed for this phase's read patterns (§23).
- **`expiresAt`** — nullable, no default. Per `docs/DATABASE_DESIGN.md`
  §6: *"guest carts get a TTL; authenticated carts don't need one."* No
  TTL duration or expiry-sweep job is specified anywhere in the approved
  architecture — flagged in §33 (open questions), not invented here.

### `cart_items`

```prisma
model CartItem {
  id                 BigInt   @id @default(autoincrement()) @db.UnsignedBigInt
  cartId             BigInt   @map("cart_id") @db.UnsignedBigInt
  productVariantId   BigInt   @map("product_variant_id") @db.UnsignedBigInt
  quantity           Decimal  @db.Decimal(12, 3)
  priceSnapshotMinor Int      @map("price_snapshot_minor") @db.UnsignedInt
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  cart           Cart           @relation(fields: [cartId], references: [id], onDelete: Cascade)
  productVariant ProductVariant @relation(fields: [productVariantId], references: [id], onDelete: Cascade)

  @@unique([cartId, productVariantId], map: "uq_cart_items_cart_variant")
  @@map("cart_items")
}
```

- **`uq_cart_items_cart_variant`** — a plain composite unique index (not
  generated) on `(cartId, productVariantId)`. At most one row per variant
  per cart — preserved exactly, never worked around.
- **FKs are both `ON DELETE CASCADE`** — deliberately different from
  `OrderItem`'s `SET NULL` informational-FK pattern: a cart item has no
  historical-record obligation (unlike an order line), so if its cart or
  variant is deleted, the row itself should simply disappear.
- **`quantity` is `DECIMAL(12,3)`** — identical precision to
  `order_items.quantity`/Inventory's quantity columns.
- **`priceSnapshotMinor` exists and is `NOT NULL`** — analyzed in §7.
- **No CHECK constraint** on `cart_items` (confirmed by grepping every
  migration file for "CHECK" — none references this table).

### The concurrent-cart-creation race — already specified

`docs/DATABASE_DESIGN.md` §22 explicitly prescribes the mechanism for
"two requests race to create an `ACTIVE` cart for the same user/guest
token": *"The first `INSERT` succeeds; the second's `INSERT` collides
with `uq_one_active_cart_per_user`/`uq_one_active_cart_per_guest_token`
and fails outright with a duplicate-key error... The use-case catches
that duplicate-key error and falls back to re-reading the now-existing
`ACTIVE` cart rather than treating it as a real failure — a standard
'insert, or fetch the row someone else just inserted' pattern."* This is
adopted verbatim for the analogous cart-item race in §12 below, and
exercised directly by concurrency scenario 5 in §28 — not re-derived, not
reinvented.

### Schema sufficiency verdict

**The existing schema is sufficient for everything this plan proposes to
build in Phase 7.** No migration is required. The one place a genuine gap
exists — no direct `orders.cartId` FK, meaning a lost-response checkout
retry cannot be answered with "here is the exact order your cart
produced" — is analyzed in full in §15 and listed as open question 2 in
§33, as a deliberate, disclosed design trade-off, not a silent gap.

---

## 2. Cart domain model

A cart is a **mutable** shopping-intent record: quantities, item
selection, and display pricing may all change freely while `ACTIVE`. It
is never the authoritative source for price, availability, or product
identity — those are re-resolved from Catalog/Inventory every time they
matter (§9/§10/§20). Once `CONVERTED`, a cart becomes historical/read-only
(§13); its content has already been immutably copied into `order_items`
by that point, so the cart row itself is a UX/audit convenience, not a
second source of truth (`docs/DATABASE_DESIGN.md` §6's own framing for
retention — no purge job is built in this phase, §33 open question 4).

---

## 3. Cart ownership model

Exactly two identity axes, mutually exclusive (enforced by
`chk_carts_identity_exclusive`):

| Actor | Identity field | Resolved from |
|---|---|---|
| Authenticated user | `carts.userId` | `requireSessionUser()`/`getSessionUser()` (existing, unchanged) |
| Guest browser | `carts.guestTokenHash` | A new guest-cart cookie (§5) — resolved server-side, never client-asserted |

No new identity table is created. `userId`/`guestTokenHash` are the only
two fields the schema provides, and they are sufficient — this plan does
not invent a third.

---

## 4. Guest-token security — resolved precisely (the architecture under-specifies this)

`docs/ARCHITECTURE.md` §5 states only: *"Guest identity is a signed,
httpOnly cart token cookie."* `docs/DATABASE_DESIGN.md` §6 adds:
*"`guest_token_hash`... hash of a signed httpOnly cookie value, same
principle as `sessions.session_token_hash`."* Neither document specifies:
a cookie name, a hashing algorithm, cookie attributes specific to this
cookie, rotation, or exact expiry. Per this plan's own instruction ("If
the existing architecture does not specify these details, resolve them
explicitly in the plan"), this section resolves them — **by reusing
existing, already-battle-tested infrastructure, not inventing a new
scheme**:

- **Generation**: `src/integrations/crypto/tokens.ts`'s existing
  `generateRawToken()` — `randomBytes(32).toString("base64url")` (256
  bits of CSPRNG entropy) — the exact function already used for session
  tokens and verification tokens. No new token-generation code is written.
- **Hashing**: the same file's existing `hashToken()` —
  `createHash("sha256").update(rawToken).digest("hex")` — producing
  exactly 64 hex characters, matching `guestTokenHash`'s `@db.Char(64)`
  column precisely (this is not a coincidence Phase 7 needs to solve; the
  column was already sized for this exact function's output).
- **On "signed"**: `ARCHITECTURE.md`'s phrasing is interpreted as
  describing the *functional* property an opaque, high-entropy,
  server-side-hash-verified token already provides (unguessable,
  tamper-evident by construction — a forged cookie value will never match
  any stored hash), **not** a literal instruction to implement JWT/HMAC
  signing. The existing session-cookie mechanism (`lib/session.ts`) is
  explicitly documented as *"the raw token only, never a signed/sealed
  value; the cookie is an opaque lookup key"* — and `DATABASE_DESIGN.md`
  §6 explicitly says the guest token follows *"the same principle as
  `sessions.session_token_hash`."* Implementing literal cryptographic
  signing (JWT/HMAC) here would be a genuinely new mechanism with zero
  precedent anywhere in this codebase, inconsistent with the sessions/
  verification-tokens pattern the architecture itself cites as the
  model to follow. This plan adopts the **proven, precedented**
  interpretation.
- **Cookie name**: `guest_cart_token` — a new constant, alongside the
  existing `SESSION_COOKIE_NAME` in `src/modules/auth/constants.ts`'s
  sibling module (`src/modules/cart/constants.ts`).
- **Cookie attributes**: identical to `lib/session.ts`'s
  `setSessionCookie` — `httpOnly: true`, `secure: env.NODE_ENV ===
  "production"`, `sameSite: "lax"`, `path: "/"` — plus an explicit
  `expires` matching the cart's own `expires_at` (§1: guest carts get a
  TTL). Proposed TTL: 30 days from cart creation (not specified anywhere
  in the approved architecture; chosen as a reasonable, explicit default
  for this plan, flagged in §33 open question 1 for confirmation rather
  than silently assumed to be uncontroversial).
- **Rotation**: none. A guest token is generated once per guest cart and
  lives for that cart's lifetime — matching the simplicity of the
  existing verification-token model (single-use-scoped, not
  periodically rotated). Rotating on every request would require
  updating the stored hash on every mutation for no security benefit this
  plan can identify (the threat model — a stolen cookie value — is
  identical to session-cookie theft, for which this codebase does not
  rotate either).
- **Never logged**: the raw token is never passed to the Pino logger
  (§30, Observability) — only `guest_token_hash`'s own value (already a
  one-way hash, safe to reference in logs if ever needed for debugging)
  or, more commonly, the cart's numeric `id`.

---

## 5. Authenticated + guest cart identity resolution

A new `resolveCartActor()`-style helper (in `lib/cart-actor.ts`, mirroring
`lib/session.ts`'s placement rationale — framework-aware, so use-cases
never import `next/headers` directly):

```
1. Check for an authenticated session (getSessionUser()).
   - If present: identity = { type: "user", userId: actor.id }.
2. Else, check for the guest-cart cookie.
   - If present and its hash resolves to a real (any-status) cart: identity = { type: "guest", guestTokenHash: hash(rawToken) }.
   - If present but resolves to nothing (expired/invalid): treat as absent.
3. Else (first-ever visit, no session, no cookie): identity = { type: "none" }.
   A cart is only created lazily, on the first mutating call (§10) — not on every page view.
```

An authenticated user is **never** treated as a guest even if a stale
guest cookie is also present (§6 covers what happens to that guest cart
at that point — it is a merge candidate, not an active identity).

---

## 6. Guest ↔ authenticated cart merge — resolved explicitly (not pre-designed anywhere)

Grounding confirmed: `docs/ARCHITECTURE.md` §19/§20 explicitly defer
**guest-order-to-account linking** (a different, already-decided-against
feature — deliberately not automatic, to avoid account-takeover-via-
email-guessing). **Cart merging is a distinct question the architecture
never addresses at all** — not deferred, not decided, genuinely open.
This plan resolves it now, deterministically, per the instruction not to
leave it to implementation-time judgment.

**Trigger**: merge runs once, synchronously, as part of the
login/registration use-case's own success path (`src/modules/auth/use-cases/login.ts`
and `register.ts` gain one new call each to `mergeGuestCartIntoUserCart`)
— not a separate endpoint the client calls.

**Policy — chosen**: **union by variant, guest quantity added on top of
the user's existing quantity**, explicit and deterministic:

| Case | Behavior |
|---|---|
| User has no `ACTIVE` cart, guest cart exists | The guest cart's `userId` is *not* simply reassigned (it would violate `chk_carts_identity_exclusive`'s "exactly one axis" invariant if done naively, and would leave `guestTokenHash` stale) — instead, a **new/existing user cart is used as the target**, guest items are copied into it, and the guest cart is marked `CONVERTED` (see "cart status after merge" below). If the user genuinely has zero cart history, this is operationally identical to "the guest cart becomes the user's," but implemented as a copy, not a mutation-in-place, so the identity-axis invariant is never at risk. |
| User already has an `ACTIVE` cart | Both carts' items are merged into the user's `ACTIVE` cart (target), guest cart items are copied over. |
| Same variant in both carts | **Quantities are added together** (`userQuantity + guestQuantity`), capped by nothing at merge time (checkout is the real gate, §10) — this is the simplest, most predictable rule a customer can understand ("my guest browsing items got added to my account cart"), and avoids ambiguous "which price/which one wins" questions entirely, since quantity is the only thing being combined. |
| Variant in guest cart is inactive/archived at merge time | **Dropped silently from the merge, not copied** — an inactive/archived variant is not purchasable, so carrying it forward serves no purpose; this is disclosed as an intentional simplification (a "some items could not be merged" UX notice is a future enhancement this plan does not build — no cart-mutation use-case in this phase returns a structured "partial merge" report; it is deferred, flagged as open question 5 in §33, not silently different from what's stated here). |
| Variant's current inventory is 0/unavailable at merge time | **Still merged** — availability is checked at checkout (§10), not at merge or add-time; merging is about *intent*, not a purchasability gate. |
| Price differs between when guest added it and now | Irrelevant — `cart_items.priceSnapshotMinor` is display-only (§7) and is refreshed to the current price as part of the merge-copy operation (the same "resolve current price" logic every cart mutation already performs, §9). |
| Cart-item uniqueness conflict | Never arises structurally — the merge target's own `uq_cart_items_cart_variant` constraint is respected by using an upsert-with-increment per variant (§12), not a raw copy that could collide. |

**What happens to the guest cart afterward**: marked `CONVERTED` (not
`ABANDONED`) — its contents were successfully absorbed into a real,
ongoing cart, which is a "successful" outcome for that cart's lifecycle,
distinct from a customer literally abandoning their cart. The guest
cart's own `activeCartGuestKey` immediately becomes `NULL` (generated
column reacting to the status change), and the guest cookie is cleared
(`clearGuestCartCookie()`, mirroring `clearSessionCookie()`) — a stale
guest cookie must never resolve to a `CONVERTED` cart being treated as
`ACTIVE` again.

**Never silently discarded**: if the merge transaction fails for any
reason, neither cart's status changes (§11's locking strategy makes this
atomic) — the guest cart remains `ACTIVE` and its cookie remains valid,
so a retry (or the next request) can attempt the merge again idempotently
(merging an already-`CONVERTED` guest cart is a no-op the merge use-case
detects and skips, per the guard-failure-recheck pattern established in
Phase 5/6, §11).

---

## 7. Cart item semantics and price freshness

The client submits only `variantId` + `quantity` for every cart mutation
— never a price, name, or SKU (matching Order's `createOrder` input
contract exactly, `src/modules/order/schema.ts`'s established shape).

**Why `cart_items.priceSnapshotMinor` exists, and exactly when it's
written**: it is a **display-only convenience**, so a cart page/summary
can render a subtotal without an extra Catalog join on every read. It is
written:
- On item creation (add-to-cart): current `product_variants.priceMinor`
  at that moment.
- On quantity update: **refreshed** to the current price at that moment
  (not left stale) — since the mutation already touches the row, keeping
  the display price current is free.
- **Never** on a bare read (`getActiveCart` does not silently mutate rows
  it's only displaying).

**The authoritative rule, stated once, applying everywhere**: *checkout
resolves the current authoritative catalog price before creating the
Order — never the cart's stored snapshot.* This reuses
`src/modules/order/repo.ts`'s existing, already-tested
`resolveOrderLine(variantId)` function directly (§14) — Checkout does not
duplicate that price/identity-resolution logic, it calls the same
function Order's own `createOrder` already relies on. `cart_items.priceSnapshotMinor`
is **never read** by the checkout path at all; it exists purely for
Cart's own display use-cases (§23).

---

## 8. Quantity model

Reuses the exact `DECIMAL(12,3)` precision and validation shape already
established twice (`src/modules/inventory/quantity.ts`,
`src/modules/order/quantity.ts`) — a third small, deliberate duplication
(`src/modules/cart/quantity.ts`) with the same three predicates
(`isFiniteQuantity`, `isPositiveQuantity`, `hasValidQuantityPrecision`),
keeping Cart independent per the established Phase 4→7 precedent.

- **Minimum**: `> 0` (a zero/negative quantity is rejected at the schema
  layer — "remove the item" is a distinct, explicit operation, §24, never
  expressed as `quantity: 0`).
- **Maximum**: **no arbitrary cap is imposed at the cart layer.**
  Inventory availability is the natural ceiling, checked non-authoritatively
  at add/update time (via Inventory's existing `getAvailableQuantity`,
  purely informational — a cart is allowed to hold more than is currently
  available, since availability can change before checkout) and
  authoritatively at checkout (§10). Imposing a separate hard cap here
  would be an invented business rule with no grounding in the approved
  architecture.
- **Decimal precision**: identical `≤ 3 decimal places` rule.
- **Whole-unit-only variants**: the schema does not currently expose a
  per-variant "whole units only" flag (`products.unitOfMeasure` is
  `EACH`/`METER` at the *product* level, an existing Catalog field, not
  cart-specific) — Cart does not invent new validation keyed off this
  field beyond what Catalog/Order already established. If a future phase
  wants a stricter per-variant integer-only rule, that is a Catalog-layer
  decision, out of scope here.

---

## 9. Cart price freshness (restated as its own decision point)

Explicitly choosing among the plan's own listed options: **the cart
stores a display snapshot (§7), refreshed on mutation, never treated as
authoritative; checkout always re-resolves the current catalog price.**
Not "cart stores no price at all" (that would force an expensive join on
every cart read for zero benefit) and not "cart price is refreshed
whenever the cart is read" (that would make reads have side effects,
violating the general principle that reads shouldn't mutate rows,
and would race with concurrent price changes for no correctness benefit
since checkout re-resolves anyway).

---

## 10. Cart does not reserve inventory

Hard rule, preserved exactly as instructed: **no code path in this
module ever calls `reserveInventoryForNewOrderItem`,
`reserveInventory`, or any other Inventory mutation.** Every cart
use-case (§24) is read/write against `carts`/`cart_items` only, plus
non-authoritative `getAvailableQuantity` calls for display/UX purposes.
The **only** place inventory is ever reserved is inside Checkout's
composed transaction (§16), which is order creation, not cart mutation.

---

## 11. Cart mutation concurrency

**The single, uniform mechanism**: every cart-mutating use-case (add,
update quantity, remove, clear, merge, and checkout's own cart-locking
step) acquires an explicit row lock on the **parent `carts` row** via
`SELECT id FROM carts WHERE id = :cartId AND status = 'ACTIVE' FOR
UPDATE` as the **first statement** of its own transaction — before any
plain read of `cart_items` — matching the exact lesson from Phase 4's
snapshot-poisoning bug and Phase 5/6's designed-around-it primitives (a
plain read before the intended locking statement would poison the
transaction's REPEATABLE READ snapshot for every later read in that same
transaction). This single lock serializes **all** operations against one
cart, including cross-table `cart_items` mutations, because every one of
those operations is required to acquire this same lock first.

| Scenario | Locked row | Mechanism | Loser's outcome |
|---|---|---|---|
| Two quantity updates on the same cart item | `carts` row (not the item row directly) | `SELECT ... FOR UPDATE` on `carts`, then `cart_items.update` inside the same tx | Second blocks until first commits, then proceeds against fresh data — never a lost update |
| Remove item racing quantity update | `carts` row | Same lock | Whichever transaction's `FOR UPDATE` statement executes first wins; the other blocks, then proceeds against post-commit state (e.g., "update quantity on an item that was just removed" correctly re-checks item existence after acquiring the lock and returns `NotFoundError` if gone) |
| Add same variant concurrently | `carts` row + `uq_cart_items_cart_variant` | Cart-row lock serializes primarily; the unique constraint is a second, independent layer (an `upsert` with `{increment: qty}`, §12) — belt-and-suspenders, matching Phase 5's established defense-in-depth style |
| Merge guest cart racing login | **Two** `carts` rows (guest + target user cart), locked in a fixed, deterministic order (lower numeric `id` first) to prevent deadlock | Both `FOR UPDATE`, in the same transaction | A concurrent second login attempt (e.g., double-submitted login form) blocks until the first merge completes, then finds the guest cart already `CONVERTED` and skips (idempotent, §6) |
| Checkout racing cart modification | `carts` row (checkout's guarded status-transition `UPDATE ... WHERE status = 'ACTIVE'` is itself the lock-acquiring statement, §16) | Same row, same mechanism | A cart mutation that loses the race finds `status != 'ACTIVE'` after acquiring its own lock and returns a clean `ConflictError` ("this cart has already been checked out") rather than silently applying to a cart that's mid-conversion or already converted |

No scenario in this table is solved by "use a transaction" alone —every
row has an explicit statement identified as the lock-acquiring one.

---

## 12. Cart item uniqueness

`uq_cart_items_cart_variant` is preserved exactly, never worked around.
**Add-to-cart is implemented as an atomic upsert**, not
check-then-insert:

```ts
tx.cartItem.upsert({
  where: { cartId_productVariantId: { cartId, productVariantId } },
  create: { cartId, productVariantId, quantity, priceSnapshotMinor },
  update: { quantity: { increment: quantity }, priceSnapshotMinor },
});
```

Combined with §11's cart-row lock (held for the duration of the same
transaction), this is doubly safe: the lock already serializes concurrent
adds for the same cart, and the upsert itself is safe even in the
(should-be-unreachable) case of a lock-discipline violation, mirroring
exactly the "insert, or fetch/update the row someone else just touched"
pattern `docs/DATABASE_DESIGN.md` §22 already prescribes for the
cart-creation race itself (§1).

---

## 13. Cart status transitions

Exact state machine, using only the three existing `CartStatus` values —
no invented states:

| From | To | Trigger | Buildable in Phase 7? |
|---|---|---|---|
| *(none)* | `ACTIVE` | First mutating cart action for a fresh identity (lazy creation, §5) | **Yes** |
| `ACTIVE` | `CONVERTED` | Successful checkout (order created) **or** successful guest→user merge (the guest cart's own transition, §6) | **Yes** |
| `ACTIVE` | `ABANDONED` | Explicit customer action ("empty my cart" is a different operation — clearing items, not abandoning the cart record) **or** a future TTL-sweep job | **Partially** — no use-case in this phase transitions a cart to `ABANDONED` at all; the state is schema-supported and the state machine (a pure function, mirroring `order-state-machine.ts`'s shape) knows it exists, but nothing calls it. Automatic abandonment requires a scheduled job (open question 4, §33 — no job-runner infrastructure exists anywhere in this codebase, matching Order's identical TTL-sweep limitation). |
| `CONVERTED`/`ABANDONED` | *(anything)* | — | **Forbidden, always** — both are terminal. A converted cart must never be reused for another checkout (§16's guarded transition already makes this structurally true: its `WHERE status = 'ACTIVE'` clause can never match again). |

`CartTransitionEvent` values: `CONVERT`, `ABANDON` — a pure
`nextState(current, event): CartStatus | null` function, unit-tested
exhaustively, exactly mirroring `order-state-machine.ts`'s established
shape and non-throwing convention.

---

## 14. Checkout architecture — module ownership, not a god-module

`src/modules/checkout/` is a **new, thin module** containing only
orchestration use-cases and one small repo file — it owns no Prisma model
of its own beyond writing the very first `payment_attempts` row (§18).
Every other write happens through the owning module's own (possibly new,
additive) repo primitive:

| Concern | Owner | Checkout's relationship to it |
|---|---|---|
| Current price/active-state of a variant | Catalog (via Order's already-built `resolveOrderLine`, §7) | Calls it, does not duplicate it |
| Cart contents, cart lifecycle | Cart (`src/modules/cart/repo.ts`) | Calls Cart's new tx-accepting lock/read/convert primitives |
| Immutable order snapshot, order lifecycle | Order (`src/modules/order/repo.ts`) | Calls a **new, additive** tx-accepting `createOrderInTransaction` primitive (§16) |
| Reservation | Inventory (`src/modules/inventory/repo.ts`) | Never called directly by Checkout — Order's own composed transaction already calls Inventory's existing `reserveInventoryForNewOrderItem`, unchanged from Phase 6 |
| Payment attempt, Paystack, verification | *(no Payment module yet)* | Checkout's own repo writes the **first** `payment_attempts` row only (§18) — a narrow, explicitly time-boxed exception, not a claim that Checkout owns payment state generally |

Checkout use-cases (§25) call into these repos through the **same
repo-to-repo composition pattern** Phase 6 established (Order's repo
importing Inventory's repo) — never by duplicating another module's
business logic, never by passing a `Prisma.TransactionClient` into any
use-case (§17 restates this precisely, for the specific extension this
phase requires).

---

## 15. Checkout idempotency — resolved without a new schema field

**The mechanism**: the cart's own guarded status transition
(`UPDATE carts SET status = 'CONVERTED' WHERE id = :cartId AND status =
'ACTIVE'`, checked via `result.count`) is the **entire** idempotency
primitive — exactly the same "atomic guarded UPDATE, `count === 0` means
someone else already got there" pattern Order/Inventory already use for
every other exactly-once guarantee in this codebase. **No
`idempotency_keys` table, no client-generated idempotency key header, and
no new `orders`/`carts` column is introduced.** The burden-of-proof bar
this plan was given is met: the existing schema, combined with the
existing concurrency pattern, is sufficient.

**Why not a client-generated idempotency key**: it would require a new
column (on `orders` or a new table) with no existing precedent, to solve
a problem the cart's own state machine already solves structurally — a
cart can be converted **exactly once**, ever (its generated-column
uniqueness guarantee combined with `CONVERTED`/`ABANDONED` being
terminal, §13, makes a second conversion attempt structurally
unreachable, not just application-logic-prevented).

**The lost-response-then-retry scenario, precisely**: request A converts
the cart and creates the order, but the client never sees the response;
the client retries the identical checkout call against the same
`cartId`. Request B's guarded UPDATE finds `status != 'ACTIVE'` (already
`CONVERTED` by A) and — **this is the one honest limitation this plan
discloses rather than papers over** — cannot itself return "the order A
created," because **the schema has no `orders.cartId` column**, so there
is no rigorous, FK-backed way to look up "which order resulted from this
specific cart's conversion." Adding such a column was considered and
**rejected for this phase**: it is a genuine, real schema addition with
real value, but the correctness requirement this plan was actually given
— *"the retry must NOT create Order #2"* — does not require it; that
requirement is fully satisfied by the guarded transition alone (a second
order is structurally impossible once the cart is no longer `ACTIVE`).
What the missing column costs is convenience, not correctness: request B
returns a clean `ConflictError` ("this cart has already been checked
out"), and the client's recovery path is to call Order's own,
already-built `getOrderById`/`listMyOrders` (`docs/PHASE_6_ORDER_PLAN.md`
§19) to find the resulting order — for an authenticated user, this works
today with zero new code; for a guest, this inherits the exact same
already-disclosed, already-deferred limitation Phase 6 flagged for guest
post-checkout order lookup in general (`docs/PHASE_6_ORDER_PLAN.md`
§17/§25). This is flagged again as open question 2 in §33 as a candidate
for a future minor schema revision (`orders.cartId`, nullable,
informational — mirroring `order_items.productId`'s "informational FK
only" pattern),
explicitly **not** decided or added now.

---

## 16. Cart-to-order transaction — the central design decision (mirrors Phase 6 §7)

### The exact sequence (derived, not assumed)

```
BEGIN (checkout/repo.ts's own db.$transaction)
  SELECT ... FOR UPDATE on the cart row, WHERE status = 'ACTIVE'   ← first statement, no snapshot-poisoning risk
  IF cart not found or not ACTIVE: throw ConflictError            ← e.g. already converted, or genuinely doesn't exist/isn't owned
  read cart_items for this cart (now safe — snapshot is fresh, established by the FOR UPDATE above, not a prior plain read)
  IF cart_items is empty: throw ValidationError ("cart is empty")
  FOR EACH cart_item:
    resolve current price/identity via orderRepo.resolveOrderLine(variantId)   ← reused verbatim from Phase 6, plan §7
    validate: variant still ACTIVE, quantity still valid
  compute totals server-side (reusing order/domain/order-totals.ts verbatim — no duplicate totals logic)
  orderRepo.createOrderInTransaction(tx, {...})   ← NEW additive primitive, §16 below — creates orders + order_items + order_addresses, and internally calls inventoryRepo.reserveInventoryForNewOrderItem(tx, ...) per line, EXACTLY as Order's existing createOrder already does
  UPDATE carts SET status = 'CONVERTED' WHERE id = :cartId AND status = 'ACTIVE'   ← the guarded transition itself; by construction this is the SAME row already locked above, so count is always 1 here — this is not a second race, it's confirming the lock held
COMMIT

-- Outside this transaction, as a separate step (never inside a DB transaction, per the hard "no external call inside a transaction" rule — and this step makes no external call either, it's a plain insert):
checkoutRepo.createInitialPaymentAttempt({ orderId, amountMinor: order.totalMinor })
```

This ordering is **derived from**, not copied verbatim from, the
brief's illustrative sketch — it differs in one deliberate way: the
brief's sketch (and `docs/DATABASE_DESIGN.md` §21's own Checkout sketch)
lists `order_addresses` insertion and inventory reservation as sibling
steps; this plan's actual sequence nests inventory reservation *inside*
`createOrderInTransaction` because that is what Phase 6 already built and
tested (`orderRepo.createOrder` already does exactly this internally) —
Checkout does not re-implement or duplicate that internal ordering, it
reuses the composed primitive as-is.

**The invariant, restated precisely**: if any line fails resolution,
validation, or reservation, the **entire** transaction — cart lock,
order, order items, order addresses, reservation, and the cart's own
status transition — rolls back together. No partial order, no partial
reservation, and critically, **the cart remains `ACTIVE`** (its own
guarded UPDATE never ran, or rolled back with everything else) — directly
satisfying the "failed checkout leaves cart recoverable" acceptance
criterion in §34.

---

## 17. Order/Inventory/Cart transaction composition — the additive extension this plan requires (not yet built)

Exactly mirroring Phase 6 §7's resolution of the identical class of
problem, one level higher in the call stack:

**The gap**: `orderRepo.createOrder` (Phase 6, unchanged) unconditionally
opens and owns its **own** `db.$transaction`. Calling it from inside
Checkout's own transaction would run it as a second, independent
transaction — the exact same "wouldn't commit/roll back together"
problem Phase 6 solved for Order↔Inventory.

**The resolution — Option A, exactly as Phase 6 chose**: Checkout's repo
owns the outer transaction; a **new, additive** tx-accepting primitive is
added to `order/repo.ts`:

```ts
export async function createOrderInTransaction(
  tx: Prisma.TransactionClient,
  data: CreateOrderData,
): Promise<OrderWithRelations>
```

— containing exactly the body `createOrder`'s own `db.$transaction`
callback already has today (the `orders`/`order_items`/`order_addresses`
inserts, the per-line `inventoryRepo.reserveInventoryForNewOrderItem(tx,
...)` calls, the initial `order_status_history` insert). The existing
public `createOrder(data)` becomes a thin wrapper: `db.$transaction(tx =>
createOrderInTransaction(tx, data))`. **Zero observable behavior change**
to `createOrder`'s existing signature, return type, or any existing
Phase 6 test's expectations — confirmed by the same discipline Phase 6
itself applied to Inventory (re-run Order's entire existing test suite
immediately after this addition, before any Checkout code exists, as the
very first implementation step, §27).

This keeps the Prisma-import boundary exactly where it already is: only
`repo.ts` files ever see `Prisma.TransactionClient`, and the composition
chain is now three levels deep (`checkout/repo.ts` → `order/repo.ts` →
`inventory/repo.ts`), each level only importing the next one down, never
skipping a level, never reaching into a use-case.

```
Route
 ↓
Checkout use-case (createCheckoutSession / completeCheckout)
 ↓
checkout/repo.ts — opens the ONE transaction, holds the cart lock
 ↓         ↓
cart/repo.ts   order/repo.ts (createOrderInTransaction, additive)
                ↓
                inventory/repo.ts (reserveInventoryForNewOrderItem, already additive from Phase 6, unchanged)
 ↓
Prisma
 ↓
MySQL
```

---

## 18. Payment-attempt boundary — Option A, chosen

`docs/ARCHITECTURE.md` §9's approved Checkout Lifecycle is explicit and
already authoritative on this exact question — it is not a genuinely
open choice this plan needs to invent an answer to:

> 6. Server: create a `payment_attempts` row with a freshly generated
>    unique reference, linked to the order
> 7. Server: call Paystack Initialize Transaction with the server-computed
>    amount

Step 6 (payment-attempt creation) is **in scope for whichever phase
builds Checkout** — this phase. Step 7 (the actual Paystack HTTP call) is
explicitly **Phase 8**. This plan therefore adopts **Option A**: Phase 7
creates the `payment_attempts` row — `status: "INITIATED"`, a
freshly-generated unique reference (reusing
`src/integrations/crypto/tokens.ts`'s `generateRawToken()` for the
reference string — the same CSPRNG helper, a new *use* of it, not a new
mechanism), `amountMinor` set to the just-created order's `totalMinor`,
`orderId` set — and stops there. **No Paystack call, no
`authorizationUrl`/`accessCode` population, no verification logic.**
Phase 8 begins exactly at "take this `INITIATED` row and actually call
Paystack Initialize."

This write happens in `checkout/repo.ts` (not Order's repo — Order
explicitly does not own payment state, `docs/PHASE_6_ORDER_PLAN.md` §8),
as a **separate step after** the main transaction commits (§16), matching
`docs/DATABASE_DESIGN.md` §21's explicit instruction that this happens
"after this commits, in a separate step" and the hard rule that no
external call (and, transitively, nothing immediately preceding one)
belongs inside a DB transaction. If this insert itself fails (a narrow
window — no external call, just a single-row insert), the order and its
reservation remain valid and committed; recovering is exactly the
already-established "Retry Payment" path (§19) — a subsequent call
creates the missing/next `payment_attempts` row against the same
`PENDING_PAYMENT` order. This narrow residual gap is disclosed here, not
hidden.

---

## 19. Payment retry

Unchanged from Phase 6, restated for completeness: **one order, many
payment attempts.** Checkout's `createInitialPaymentAttempt` (§18)
creates only the *first* one, at the moment of order creation. Any
subsequent attempt (after the first fails/abandons) is **not** a Checkout
concern at all — per `docs/ARCHITECTURE.md` §9's own "Retry path" note,
it re-enters at step 6 only, against the *existing* `PENDING_PAYMENT`
order, found via Order's already-built `getOrderById`/`getOrderByOrderNumber`.
Phase 7 does not build a "retry payment" use-case — that composition
(look up the existing order, create a new `payment_attempts` row, call
Paystack) is Phase 8's Payment-module responsibility once Paystack
integration exists.

---

## 20. Checkout validation

Every one of the following is revalidated at checkout time,
authoritatively, regardless of what the cart display last showed:

| Check | Source of truth | Failure mode |
|---|---|---|
| Cart exists, is owned by the caller (session or guest-token match) | `cart/repo.ts`'s lock-and-read | `NotFoundError`/`ForbiddenError` |
| Cart status is `ACTIVE` | Same guarded read | `ConflictError` |
| Cart is non-empty | Same read | `ValidationError` |
| Variant exists and is `ACTIVE` | `orderRepo.resolveOrderLine` (reused verbatim) | `NotFoundError`/`ValidationError` |
| Quantity still valid (positive, ≤3dp) | Cart's own stored value, re-validated | `ValidationError` |
| Current price/currency | `orderRepo.resolveOrderLine` | N/A — always re-resolved, never a failure mode in itself |
| Inventory availability | The guarded `UPDATE` inside `reserveInventoryForNewOrderItem` (authoritative) — never the cart's own belief | `ValidationError` ("insufficient stock") |

The final `OrderItem` snapshot is built exclusively from these
server-resolved values — never from `cart_items.priceSnapshotMinor` or
any other cart-stored field except `productVariantId` and `quantity`
(the only two fields Cart is trusted to supply, matching Order's own
`variantId`+`quantity`-only client contract, §7).

---

## 21. Stale-cart handling

Per the instruction to prefer deterministic conflict reporting over
silent modification: **checkout does not silently drop or "fix" invalid
cart items.** If any line fails validation (§20) — an archived product,
an inactive variant, insufficient stock — **the entire checkout attempt
is rejected** with a structured error identifying which line(s) failed
and why (a `ValidationError` whose message names the specific SKU/variant,
matching the precision Inventory's own error messages already use). The
cart itself is **not** mutated by this rejection (no items are silently
removed) — the customer/frontend is expected to review and resolve the
conflict (e.g., remove the problem item themselves via the existing
`removeCartItem` use-case, §24) and re-attempt checkout. This is the
plan's explicit choice among the four listed options ("rejects the
entire checkout" vs. "removes invalid items" vs. "asks the customer" vs.
"updates cart and returns a structured conflict") — automatic removal or
cart mutation during a read-validate-then-fail path would be a surprising
side effect on what the customer believes is still their unmodified cart.

---

## 22. Checkout error model

All reuse the **existing** `lib/errors.ts` hierarchy — no new error
hierarchy is invented, per the explicit instruction:

| Condition | Error class | Status |
|---|---|---|
| Cart not found | `NotFoundError` | 404 |
| Cart not owned by caller | `ForbiddenError` | 403 |
| Cart not `ACTIVE` (already converted/abandoned) | `ConflictError` | 409 |
| Empty cart | `ValidationError` | 400 |
| Variant unavailable/archived | `ValidationError` | 400 |
| Price changed | *(not a failure mode — always re-resolved, §9/§20)* | — |
| Inventory insufficient | `ValidationError` | 400 |
| Invalid quantity | `ValidationError` | 400 |
| Duplicate checkout (guard-failure on an already-`CONVERTED` cart) | `ConflictError` | 409 |
| Checkout already completed | Same as above — `ConflictError`, not a distinct code path | 409 |

No raw Prisma error ever reaches a Route Handler — `errorResponse()`
(`lib/http-error-response.ts`, unchanged) already guarantees this
project-wide.

---

## 23. Cart reads

| Use-case | Actor | Notes |
|---|---|---|
| `getActiveCart(identity)` | Session or guest token | Returns the caller's `ACTIVE` cart with items + resolved display data (product name/image/current-availability joined in one query — no N+1: a single `cart.findUnique({ include: { items: { include: { productVariant: { include: { product: true } } } } } })`), or `null` if none exists yet (not an error — matches `getAvailableQuantity`'s "absence is a normal state" precedent) |
| `getCartItemCount(identity)` | Session or guest token | A lightweight count-only read for a header/badge UI, avoiding the full item-join query when only a number is needed |

No cart list/pagination use-case is needed — a caller has at most one
`ACTIVE` cart by construction (§1); historical `CONVERTED`/`ABANDONED`
carts are not exposed through any Phase 7 read use-case (no product
requirement was given for "show my cart history," and Order's own
`listMyOrders` already serves the equivalent historical-record need).

---

## 24. Cart mutations

| Use-case | Input | Output | Auth | Transaction | Idempotency |
|---|---|---|---|---|---|
| `addCartItem` | identity, variantId, quantity | Updated cart | Ownership (or lazy-create, §5) | Cart-row lock (§11) + upsert (§12) | Re-adding the same variant increments quantity — a deliberate, documented behavior, not an accidental duplicate |
| `updateCartItemQuantity` | identity, cartItemId, newQuantity | Updated cart | Ownership + item belongs to caller's cart (defense-in-depth check, mirroring Phase 5's `requireMatchingOrderItem` pattern) | Cart-row lock | Setting the same quantity twice is a no-op, naturally idempotent (plain `UPDATE`) |
| `removeCartItem` | identity, cartItemId | Updated cart | Same ownership check | Cart-row lock | Removing an already-removed item returns a clean `NotFoundError` for that item, not a generic failure — cart itself is untouched |
| `clearCart` | identity | Empty cart | Ownership | Cart-row lock | Clearing an empty cart is a no-op |
| `mergeGuestCartIntoUserCart` | userId, guestTokenHash | Merged user cart | Called only from login/register's own already-authenticated context (§6) | Two-cart lock (§11), fixed order | Merging an already-`CONVERTED` guest cart is a no-op (skipped) |

No `abandonCart` use-case is built in Phase 7 (§13 — schema-aware, not
implemented; requires job infrastructure this codebase doesn't have).

---

## 25. Checkout use-cases

Minimal, non-redundant surface — two use-cases, not one per pseudo-step:

| Use-case | Input | Output | Notes |
|---|---|---|---|
| `validateCheckout(identity, cartId)` | identity, cartId | A structured "can this cart be checked out right now" report (per-line validity, current totals) | **Read-only** — no mutation, no transaction beyond simple reads. Exists so a checkout confirmation UI can show the customer authoritative numbers *before* they commit, without side effects. Reuses the exact same validation logic §20 describes, factored so `completeCheckout` doesn't duplicate it (§16's transaction re-validates inside the lock regardless — this use-case is a preview, not a replacement for that authoritative re-check). |
| `completeCheckout(identity, cartId, { shippingAddress, billingAddress?, customerNote? })` | identity, cartId, address input (matching `order/schema.ts`'s existing `AddressInput` shape exactly — reused, not redefined) | The created `Order` (Phase 6's `OrderDetail` DTO) | Performs §16's full transaction, then §18's payment-attempt creation. This is the only use-case that mutates anything. |

No separate "retry checkout" or "finalize cart conversion" use-case is
built — cart conversion is not a separate step from order creation (§16
does both atomically), and payment retry is explicitly Order/Payment
scope (§19), not Checkout's.

---

## 26. Authorization

No new RBAC permission is introduced. Cart/Checkout authorization is
**entirely identity-based** (ownership), matching the pattern
`customer` role's zero-permission design already established:

- **Authenticated user**: `requireSessionUser()`/`getSessionUser()`
  (unchanged) resolves `actor.id`; every cart use-case scopes its query
  by `userId = actor.id` — never a client-supplied `userId`.
- **Guest**: the guest-cart cookie (§4/§5) resolves `guestTokenHash`
  server-side; every guest cart use-case scopes by that resolved hash —
  never a client-supplied token or hash.
- **No admin cart access** is built — the brief's own instruction ("do
  not invent admin cart permissions... only if the existing architecture
  genuinely requires it") is satisfied by finding no such requirement
  anywhere in `docs/ARCHITECTURE.md`/`docs/DATABASE_DESIGN.md`. If a
  future support-tooling need arises, that's a new, explicit decision for
  that phase, not assumed here.

---

## 27. IDOR protection

Every mandatory scenario mapped to a concrete mechanism:

| Scenario | Mechanism |
|---|---|
| User A → User B's cart | `getActiveCart`/mutations scope by `actor.id`, never a client-supplied cart id resolves to another user's cart — `cartId` isn't even part of most inputs (identity resolves the cart; §24's `cartItemId`-taking use-cases still re-verify the parent cart's `userId`/`guestTokenHash` matches the caller before touching the item) |
| Guest A → Guest B's cart | Guest identity resolves from the **hash of the caller's own cookie**, never a client-supplied guest token/id |
| User → forged `userId` | Never read from any request body/param — always `actor.id` from the resolved session |
| User → forged `cartId` | Cart ownership re-verified server-side on every item-level operation, mirroring `requireMatchingOrderItem`'s defense-in-depth precedent |
| Guest → forged guest token | A forged raw token, if it doesn't match any stored hash, resolves to "no cart" (§5 step 2) — never an error that leaks whether a hash exists, matching the enumeration-safe precedent already established for auth (`docs/PHASE_3_AUTH_RBAC_PLAN.md`) |
| User → another user's checkout | `completeCheckout`'s cart-row lock query includes the ownership condition directly in its `WHERE` clause — a forged `cartId` belonging to someone else simply fails to match (`NotFoundError`/`ForbiddenError`, §22), never silently checks out the wrong cart |

Mandatory tests (§31, Testing matrix, below) exercise every row of this
table directly, mirroring `catalog-authorization.test.ts`'s forged-actor
pattern and `idor.test.ts`'s established conventions.

---

## 28. Concurrency strategy — all 10 mandatory scenarios, walked through precisely

Every scenario names the exact row(s) locked, the exact statement that
acquires the lock, and the loser's precise outcome — never "use a
transaction" alone. All ten reduce to combinations of the two primitives
already established: the **cart-row `FOR UPDATE`/guarded-status-`UPDATE`**
(§11/§16) and Inventory's own **guarded `UPDATE`** (unchanged from Phase
5/6).

1. **Two identical checkout requests against the same `ACTIVE` cart**
   (no client idempotency key exists, §15 — "identical" here means "same
   `cartId`"). Both attempt `SELECT ... FOR UPDATE ... WHERE status =
   'ACTIVE'` on the same cart row. Whichever acquires the row lock first
   proceeds through the full transaction (§16) and commits, converting
   the cart. The second blocks on the lock, then — once the first
   commits — re-evaluates its own `WHERE status = 'ACTIVE'` against the
   now-`CONVERTED` row, finds nothing, and its transaction exits via the
   `ConflictError` path (§16/§22) without ever reaching order creation.
   **Exactly one order is created.**
2. **Two checkout requests against the same cart, hypothetically with
   different client-supplied idempotency keys** — moot under this plan's
   design (§15): no client-supplied key is ever consulted for
   correctness, so this collapses to scenario 1 exactly. Two different
   keys change nothing about which row is locked or who wins.
3. **Checkout racing a cart quantity update.** Both acquire (or attempt
   to acquire) the same cart-row lock as their first statement. Whichever
   wins proceeds; the loser blocks, then re-evaluates post-commit state.
   If the quantity-update wins first: checkout (arriving second) reads
   the *updated* quantity when it finally acquires the lock and proceeds
   — the customer's last-second edit is honored, not silently lost. If
   checkout wins first: the cart is now `CONVERTED` by the time the
   quantity-update's lock attempt succeeds; it re-checks `status ===
   'ACTIVE'` after acquiring the lock and returns `ConflictError` ("cart
   already checked out") rather than mutating a converted cart's items.
4. **Checkout racing a cart item removal.** Identical mechanism to
   scenario 3 — same cart-row lock, same two possible orderings, same two
   correct outcomes (removal-then-checkout honors the removal;
   checkout-then-removal rejects the removal attempt cleanly).
5. **Two concurrent add-to-cart requests for the same variant.** Primary
   mechanism: the cart-row lock serializes them completely (one full
   add-item transaction completes before the other's lock attempt
   succeeds). Secondary, defense-in-depth mechanism: even if that
   discipline were somehow violated, `uq_cart_items_cart_variant` plus
   the upsert-with-increment pattern (§12) makes the outcome safe
   regardless — never two rows for the same variant, never a lost
   quantity.
6. **Guest cart merge racing checkout** (on the guest cart specifically —
   e.g., the guest checks out in one tab while logging in, which triggers
   a merge, in another). The merge (§6/§11) acquires `FOR UPDATE` on the
   guest cart row as one of its two locks. If checkout on the guest cart
   wins first, it converts the guest cart to `CONVERTED` before the
   merge's lock attempt succeeds; the merge then finds the guest cart
   already non-`ACTIVE` and treats it as an idempotent no-op (nothing to
   merge — the guest cart's contents already became a real order). If the
   merge wins first, the guest cart becomes `CONVERTED` (absorbed into the
   user's cart) before checkout's own lock attempt succeeds; checkout then
   finds the guest cart non-`ACTIVE` and returns `ConflictError` — the
   correct outcome is for the *now-merged user cart* to be checked out
   instead, which is a fresh request the client makes using the
   authenticated identity, not a state this plan silently auto-redirects.
7. **Checkout racing inventory depletion** (e.g., an admin manual
   adjustment, or another customer's checkout for the same variant,
   depletes stock between the customer's last cart view and their
   checkout click). This is not a cart-row race at all — it is resolved
   entirely by Inventory's own, unchanged, already-tested guarded
   `UPDATE` inside `reserveInventoryForNewOrderItem` (Phase 5/6): the
   checkout transaction's reservation step either succeeds (stock was
   sufficient at the moment the guarded `UPDATE` actually ran, which is
   the only moment that matters) or fails, rolling back the *entire*
   checkout transaction including the cart's status transition (§16) —
   the cart remains `ACTIVE` and recoverable (§34 acceptance criteria).
8. **Checkout transaction fails after Order creation but before inventory
   reservation.** Per §16/§17's actual composition, this specific
   ordering is **structurally impossible to observe as a partial state**:
   order creation and reservation happen inside the *same* nested call
   (`createOrderInTransaction` already performs both, per-line, exactly
   as Phase 6 built it) inside Checkout's *outer* transaction — there is
   no commit boundary between them for a failure to land in between. A
   failure anywhere in this sequence rolls back the order, every already-
   reserved line, and the cart's status transition together.
9. **Checkout transaction fails after inventory reservation but before
   cart conversion.** Same answer as scenario 8, for the same structural
   reason: the cart's guarded status `UPDATE` is the *last* statement
   inside the *same* transaction that already holds the cart's row lock
   from its *first* statement (§16) — there is no separate commit for a
   failure to land between reservation and conversion. Rollback undoes
   both together.
10. **Retry after a successful checkout commit.** Covered exhaustively in
    §15 — the retry's guarded `UPDATE` finds `status != 'ACTIVE'` and
    returns `ConflictError`; no second order is created; recovering the
    original order is a client-side re-fetch (§15's disclosed, deliberate
    limitation), not a silent duplicate.

Every test exercising these scenarios (§31) inspects final database state
via a fresh query after the race — never infers correctness from which
promise resolved or rejected alone, matching the standard this codebase
has applied since Phase 4.

---

## 29. Performance

- **Indexed cart lookup**: the generated-column unique indexes
  (`uq_one_active_cart_per_user`/`uq_one_active_cart_per_guest_token`,
  §1) already make "find my `ACTIVE` cart" an index-only point lookup —
  no new index is needed for this access pattern.
- **Indexed cart-item lookup**: `uq_cart_items_cart_variant`'s composite
  index already covers "does this cart have this variant" and "all items
  for this cart" (as its leading-column prefix) — no new index is added.
- **Bounded relation loading**: `getActiveCart` (§23) loads exactly one
  cart's items in one query with a bounded, single-level-deep `include`
  (items → variant → product) — never an unbounded list, never nested
  pagination concerns (a cart realistically holds a small, bounded number
  of distinct line items).
- **No N+1 queries**: every price/availability resolution during checkout
  validation (§20) reuses `orderRepo.resolveOrderLine` per line inside the
  existing loop structure Order's own `createOrder` already uses
  unchanged — this is the same access pattern Phase 6 already shipped and
  measured as acceptable at cart-sized (not catalog-sized) item counts.
- **Short transactions**: the cart-row lock (§11) is held only for the
  duration of a single mutation's own small number of statements — never
  across a network call, never across user "think time" (there is no
  "lock the cart while the customer is on the checkout page" concept
  anywhere in this design; the lock exists only inside each atomic
  operation).
- **No external network call inside a transaction** — restated as its own
  point because it is the single most important performance *and*
  correctness rule for Phase 8's later integration: `createInitialPaymentAttempt`
  (§18) is a plain single-row insert, deliberately placed *outside*
  Checkout's main transaction, and the (Phase 8) Paystack Initialize call
  will follow it, also outside any transaction — this plan does not
  create a structure that would tempt a future phase to wrap the payment
  attempt insert and the Paystack call in the same transaction as order
  creation.
- **No keyset pagination is needed** in this phase — no cart listing
  use-case exists (§23) that would require it.

---

## 30. Observability

Reuses the existing Pino logger/redaction infrastructure — no new logging
mechanism is introduced. Safe-to-log identifiers: cart `id`, order `id`/
`orderNumber`, the resolved `guestTokenHash` (already a one-way SHA-256
digest — logging it is no more sensitive than logging a database primary
key, and it is genuinely useful for correlating a guest's actions across
requests without exposing anything reversible), payment-attempt `id`
once created (§18), `actorType` (`SYSTEM`/`ADMIN`/`WEBHOOK`, reused from
Order's own convention).

**Never logged**, under any circumstance:
- The raw guest-cart cookie token (only its hash, which is what's stored
  and compared server-side anyway — the raw value never needs to appear
  in a log line for any legitimate debugging purpose).
- The raw session cookie token (unchanged, pre-existing rule).
- Passwords, payment credentials, Paystack secrets (unchanged, pre-existing
  rule — Phase 7 introduces no new credential type).
- Full address/contact details beyond what's already an accepted
  exception for order fulfillment (unchanged from Phase 6 — Cart
  introduces no new PII field).

---

## 31. Testing matrix

### Unit

- Cart state machine (`nextState`/`canTransition`, mirroring
  `order-state-machine.ts`'s exhaustive test shape, §13).
- Quantity validation predicates (mirroring
  `tests/unit/order-quantity.test.ts`'s exact shape, §8).
- Merge-quantity-combination pure logic (given two item lists, produce
  the merged result, §6) — tested in isolation from any database.
- Checkout conflict-detection classification (given a set of resolved
  line validations, produce the correct error/report shape, §20/§21) —
  pure, no I/O.

### Integration — real MySQL

- Create/get active cart (authenticated and guest).
- Add item (including the increment-on-duplicate-variant behavior, §12).
- Update quantity, remove item, clear cart.
- Duplicate-variant addition converges to one row (§12).
- Guest cart creation, authenticated cart creation, the
  insert-then-recover-on-duplicate-key pattern (§1) for the concurrent
  first-ever-cart race specifically.
- Guest → authenticated merge: no existing user cart; existing user cart;
  overlapping variant (quantity summed); inactive-variant-in-guest-cart
  dropped; already-`CONVERTED` guest cart merge is a no-op.
- Stale price (cart shows old `priceSnapshotMinor`, checkout resolves
  current price — order's `unitPriceMinor` matches the *current* catalog
  price, not the cart's stored one).
- Inactive/archived product or variant at checkout time — rejected
  (§20/§21), cart itself unmodified.
- Insufficient inventory at checkout — rejected, cart itself unmodified,
  no partial order (reuses Phase 6's exact rollback-proof pattern, §28
  scenario 7/8/9).
- **Checkout success**: full happy path — order created, reservation
  created, cart `CONVERTED`, `payment_attempts` row created with
  `status: INITIATED`.
- **Checkout rollback**: the mandatory rollback-proof test, mirroring
  Phase 6's own (a deliberate failure injected after reservation, before
  the cart's own status transition commits) — confirms *nothing* survives:
  no order, no order items, no reservation, and critically, **the cart is
  still `ACTIVE`**.
- Payment-attempt boundary: the row is created with the correct
  `orderId`/`amountMinor`/`status: INITIATED`/a unique reference, and
  nothing beyond that (no `authorizationUrl`, confirming Phase 8's
  boundary is respected).
- IDOR: every row of §27's table, mirroring `idor.test.ts`'s and
  `catalog-authorization.test.ts`'s established conventions.
- Authorization: the full customer/staff/super_admin × every use-case
  matrix, mirroring `order-authorization.test.ts`'s exact structure —
  though Cart/Checkout has no staff/admin path at all (§26), so this
  matrix is simpler than Order's: customer-vs-customer and
  guest-vs-guest only.

### Concurrency (mandatory, real MySQL, genuinely overlapping operations)

All 10 scenarios from §28, each inspecting final database state via a
fresh query — never inferring correctness from returned promises alone.
**Run at least 5 consecutive times; zero flaky failures**, matching the
bar every prior phase in this codebase has already met.

### E2E

Minimal, real HTTP, no browser (`request` fixture only, matching
`tests/e2e/order.spec.ts`'s established pattern) — no storefront UI. At
minimum: create a guest cart over HTTP, add an item, complete checkout,
confirm the resulting order and `payment_attempts` row via the admin
endpoints already built in Phase 6; one forged-field test (e.g. a forged
`priceSnapshotMinor`/`userId` in a cart-mutation request body has no
effect); one unauthenticated-rejection test for a mutating endpoint.

---

## 32. Implementation order

Derived from this plan's actual dependency structure:

1. `cart/domain/cart-state-machine.ts` (pure, zero I/O, unit-testable
   first — mirrors `order-state-machine.ts`).
2. `cart/quantity.ts` (pure, small duplication, mirrors
   `order/quantity.ts`).
3. `src/integrations/crypto/tokens.ts` reuse confirmed — no new file
   needed for token generation/hashing (§4); only the new cookie-name
   constant and cookie-setting helpers are new (`lib/cart-actor.ts`,
   `src/modules/cart/constants.ts`).
4. `cart/schema.ts`, `cart/types.ts` (Zod input shapes, DTOs, matching
   Order/Inventory's exact conventions).
5. `cart/repo.ts`: reads first, then the cart-row-lock-first mutation
   primitives (add/update/remove/clear), then the merge primitive.
6. Cart use-cases (§24), then cart API routes.
7. **The Order-side additive extension** (`createOrderInTransaction`,
   §17) — built and verified *before* any Checkout code exists, with
   Order's *entire* existing test suite re-run immediately afterward to
   confirm zero regression (the exact discipline Phase 6 applied to its
   own Inventory extension).
8. `checkout/repo.ts`: the composed transaction (§16), then the
   payment-attempt-creation step (§18).
9. `checkout/use-cases/validate-checkout.ts`, then
   `checkout/use-cases/complete-checkout.ts`.
10. Minimal API routes (§31's e2e scope).
11. Unit tests (can start as early as step 1).
12. Integration tests — happy paths first, then failure/authorization/
    IDOR, then the mandatory 10-scenario concurrency suite last, since it
    depends on everything above being correct first.
13. E2E tests.
14. Full verification suite (typecheck/lint/format/unit/integration/
    concurrency ×5+/e2e/production build/ESLint boundary re-test/security
    scan/database-cleanliness), matching every prior phase's bar exactly.
15. Implementation report, disclosing any deviations found during
    implementation, per the established convention.

---

## 33. Open questions (flagged, not silently decided)

1. **Guest cart cookie TTL (30 days, proposed in §4)** — not specified
   anywhere in the approved architecture; this plan picks a concrete
   default rather than leaving it undefined, but it is a product decision
   worth explicit confirmation, not a technical constraint.
2. **No `orders.cartId` FK** (§15) — the correctness requirement
   ("no duplicate order") is met without it; the convenience cost
   (retry-recovery requires a client-side re-fetch, not an automatic
   "here's your existing order" response) is disclosed, not hidden. A
   future minor schema revision could add it if this cost proves
   material in practice.
3. **Guest post-checkout order lookup** — inherits Phase 6's own
   already-disclosed open question (`docs/PHASE_6_ORDER_PLAN.md` §17/§25)
   unchanged; Phase 7 does not solve it, and the cart-to-order boundary
   doesn't make it any easier or harder than Phase 6 already found it.
4. **Cart/guest abandonment automation** (§13) — schema- and
   state-machine-aware, but no job runner exists anywhere in this
   codebase to actually perform it (identical shape to Order's own
   TTL-sweep limitation, `docs/PHASE_6_ORDER_PLAN.md` §10/§25).
5. **Partial-merge reporting** (§6) — silently-dropped inactive variants
   during guest→user merge are not surfaced back to the customer in any
   structured way in this phase; a future enhancement, not a Phase 7
   deliverable.
6. **Whether the merge-quantity-addition policy (§6) is the desired
   product behavior** — this plan adopts it as the single most
   predictable, unambiguous rule available, but it is a genuine product
   choice (as opposed to, e.g., "guest items only added if the variant
   isn't already in the user's cart") flagged for explicit confirmation
   alongside plan approval, exactly as Phase 6's customer-self-cancellation
   question was.

---

## 34. Acceptance criteria

### Cart

- [ ] One `ACTIVE` cart per authenticated user, one `ACTIVE` cart per
      guest token — already schema-enforced (§1), preserved, not
      re-implemented.
- [ ] Historical (`CONVERTED`/`ABANDONED`) carts preserved, unrestricted
      in number (§1/§13).
- [ ] Duplicate cart-item variant prevented — `uq_cart_items_cart_variant`
      plus the upsert pattern (§12).
- [ ] Guest/auth merge is deterministic — quantity-summed, inactive
      variants dropped, guest cart marked `CONVERTED` (§6).
- [ ] Cart ownership enforced entirely server-side (§26/§27).
- [ ] Guest token never stored or logged raw — only its SHA-256 hash
      (§4/§30).

### Checkout

- [ ] Current catalog price is authoritative, never the cart's stored
      snapshot (§7/§9/§20).
- [ ] Inventory is not reserved until checkout (§10).
- [ ] The Order snapshot remains immutable, unchanged from Phase 6 (§16).
- [ ] Inventory reservation is atomic with order creation — structurally
      guaranteed, not just tested (§16/§17, concurrency scenarios 8-9,
      §28).
- [ ] Cart conversion is atomic with successful checkout — same
      transaction, same lock (§16).
- [ ] **Failed checkout leaves the cart `ACTIVE` and recoverable** — no
      partial order, no partial reservation, no premature conversion
      (§16, concurrency scenario 7, §28).
- [ ] Duplicate checkout cannot create a duplicate order — the guarded
      cart-status transition alone guarantees this structurally (§15/§28
      scenario 1).
- [ ] No external HTTP call occurs inside any database transaction — the
      payment-attempt insert and the (Phase 8) Paystack call both live
      strictly outside Checkout's transaction (§18/§29).
- [ ] The payment-attempt boundary (§18, Option A: Phase 7 creates the
      `INITIATED` row; Phase 8 calls Paystack) is explicitly approved.

### Security

- [ ] IDOR protection verified against every row of §27's table.
- [ ] No client-authoritative pricing, totals, or ownership field is ever
      trusted (§7/§20/§26).
- [ ] No raw guest-token storage or logging (§4/§30).

### Concurrency

- [ ] All 10 mandatory scenarios (§28) mapped to a named mechanism, not
      "use a transaction."
- [ ] Every concurrency test inspects final DB state via a fresh query
      (§31).
- [ ] Concurrency suite run at least 5 consecutive times with zero flaky
      failures (§31).

### Architecture

- [ ] Cart owns cart state; Order owns order state (unchanged from Phase
      6); Inventory owns inventory state (unchanged from Phase 5);
      Checkout orchestrates without owning a database entity of its own
      beyond the initial payment-attempt row (§14).
- [ ] Prisma remains repository/infrastructure-only — the
      `Prisma.TransactionClient` composition chain never reaches a
      use-case (§17).
- [ ] No schema/migration change is requested — confirmed sufficient in
      §1.
- [ ] The guest-token security design (§4), the guest↔authenticated cart
      merge policy (§6), the checkout idempotency mechanism (§15), and
      the Order↔Inventory↔Cart transaction composition strategy (§17)
      are each explicitly approved as their own decision points.
- [ ] All open questions (§33) are acknowledged as genuinely open, not
      silently resolved.
- [ ] Explicit approval is given to proceed to implementation, following
      the hard stop this plan itself is bound by: no code, repo, use-case,
      migration, route, Server Action, UI, Paystack integration, webhook,
      refund, or payment-worker logic exists yet, and none will be
      written until this document is approved.

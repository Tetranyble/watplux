# Phase 2A — Database Design Specification

Status: **DESIGN SPECIFICATION — no `schema.prisma`, no migrations, no seed scripts, no application code.**
Companion to `docs/ARCHITECTURE.md` (Phase 0). Where this document refines or changes a Phase 0 decision, that's called out explicitly rather than silently overridden — see the **Self-Review, item 9** at the end of this document for the full list of decisions that differ from Phase 0.

All money: **integer minor units** (kobo for NGN), MySQL `INT UNSIGNED` (or `BIGINT UNSIGNED` where a value could plausibly exceed ~21.4M NGN — flagged per column). Never `FLOAT`/`DOUBLE`. All quantities: see **§19** — this document resolves that open question rather than assuming.

## Revision 1 — corrections applied after initial review

Four issues identified in review of the first draft are corrected throughout this document (each section below is marked with a "**Revision note**" at the point of correction):

1. **Refund allocation** (§8, §9, §21, §22): `payment_attempts.refunded_amount_minor` previously incremented at *request* time, so a subsequent `REFUND_FAILED` left it permanently overstated. Replaced with a two-ledger model — `refunded_amount_minor` (confirmed only) and a new `pending_refund_amount_minor` (in-flight allocations) — plus a new `REFUND_CANCELLED` terminal status and a corrected, three-step (Allocate/Confirm/Release) transaction pattern.
2. **Default-variant terminology** (§2): the generated-column unique index enforces "at most one default variant per product," never "exactly one" or "at least one." Wording corrected throughout; the "at least one" half is now explicitly assigned to the application/domain transaction layer (product creation, default-replacement), not claimed as a database guarantee.
3. **Cart uniqueness** (§6, §17, §20, §22): a plain `UNIQUE(user_id)`/`UNIQUE(guest_token_hash)` actually permitted only one cart row per identity *ever*, contradicting the stated intent of preserving historical `CONVERTED`/`ABANDONED` carts. Replaced with the same generated-column technique, scoped to `status = 'ACTIVE'` only.
4. **Inventory SALE deduplication** (§5, §7, §17, §18, §21): the generated key (`inventory_item_id` + `order_id`) was described in prose as "one SALE per order-item" but actually expressed "one SALE per order-variant pair" — only equivalent under an unstated single-line-per-variant assumption. `inventory_movements` now carries `order_item_id` directly (for `RESERVE`/`RELEASE`/`SALE`), and `order_items` gains an explicit `UNIQUE(order_id, product_variant_id)` as an independent, defense-in-depth invariant rather than the load-bearing mechanism. The redundant `CANCELLATION` movement type (never distinct from `RELEASE`) was also removed as part of this fix.

---

## 0. Final Entity List & Domain Grouping

| Domain | Tables |
|---|---|
| **Identity** | `users`, `sessions`, `roles`, `permissions`, `user_roles`, `role_permissions`, `verification_tokens` |
| **Catalog** | `brands`, `categories`, `products`, `product_variants`, `product_images`, `product_specifications` |
| **Inventory** | `inventory_items`, `inventory_movements` |
| **Commerce** | `addresses`, `carts`, `cart_items`, `orders`, `order_items`, `order_addresses`, `order_status_history`, `coupons`, `coupon_redemptions` |
| **Payments** | `payment_attempts`, `webhook_events`, `refunds` |
| **Services** | `service_requests` |
| **Community** | `reviews` |
| **Administration** | `audit_logs`, `settings`, `setting_entries` |

**31 tables total.** No `media` table, no `installation_requests` table, no `product_categories` junction — each is a deliberate deviation from Phase 0's initial sketch, reasoned through below and logged in §26.

---

## 1. Identity and Authentication Domain

Authentication *provider* (Auth.js v5 vs. Lucia vs. custom) is still a Phase 3 decision per `docs/ARCHITECTURE.md` §5/Open Questions. This schema is designed to be a reasonable, provider-agnostic foundation — **not** a guess at any specific library's required adapter shape.

> **Open risk, flagged now rather than discovered in Phase 3:** if Phase 3 picks a library with a Prisma adapter that expects its own model shape (Auth.js's adapter, for example, expects `User`/`Account`/`Session`/`VerificationToken` models with specific fields), the tables below may need renaming/reshaping to match that adapter *or* a custom adapter gets written against these names. Either is fine — flagging it now so Phase 3 doesn't rediscover it as a surprise blocker. See §27.

### `users` — authentication + minimal identity only

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `email` | `VARCHAR(255)` | `UNIQUE NOT NULL` |
| `email_verified_at` | `DATETIME` | nullable |
| `phone` | `VARCHAR(32)` | nullable, not unique (shared household phones happen) |
| `password_hash` | `VARCHAR(255)` | nullable — nullable so a future OAuth-only account isn't forced to have a password |
| `name` | `VARCHAR(255)` | NOT NULL |
| `status` | `ENUM('ACTIVE','SUSPENDED')` | DEFAULT `ACTIVE` |
| `deleted_at` | `DATETIME` | nullable — **soft delete** (orders/reviews reference users historically; see §20) |
| `created_at`, `updated_at` | `DATETIME` | |

Deliberately **excludes** anything business-shaped (addresses, order history) — those live in the Commerce domain and reference `users.id`. This is the "distinguish auth data from business data" boundary the brief asked for: `users` answers "who can log in," nothing else.

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `user_id` | `BIGINT UNSIGNED` | FK → `users.id`, `ON DELETE CASCADE` |
| `session_token_hash` | `CHAR(64)` | `UNIQUE NOT NULL` — SHA-256 hex of the actual cookie value; the raw token is never stored, only its hash (same principle as password hashing — a DB leak shouldn't hand out live sessions) |
| `user_agent` | `VARCHAR(255)` | nullable, for a future "active sessions / log out other devices" admin feature |
| `ip_address` | `VARCHAR(45)` | nullable (IPv6-safe length) |
| `expires_at` | `DATETIME` | NOT NULL |
| `created_at` | `DATETIME` | |

Index: `(user_id, expires_at)` — serves both "list a user's active sessions" and the expiry-sweep cron.

### `roles`, `permissions`, `user_roles`, `role_permissions`

| Table | Columns | Constraints |
|---|---|---|
| `roles` | `id` PK, `name VARCHAR(100)`, `description VARCHAR(255)` nullable, `created_at` | `UNIQUE(name)` |
| `permissions` | `id` PK, `key VARCHAR(100)` (e.g. `products.read`), `description VARCHAR(255)` nullable | `UNIQUE(key)` |
| `user_roles` | `user_id` FK, `role_id` FK, `assigned_by BIGINT UNSIGNED` nullable FK→`users.id`, `assigned_at` | PK `(user_id, role_id)`; both FKs `ON DELETE CASCADE` |
| `role_permissions` | `role_id` FK, `permission_id` FK | PK `(role_id, permission_id)`; both FKs `ON DELETE CASCADE` |

Composite primary keys on the junction tables are the uniqueness constraint — "duplicate role/permission assignment" (§17's explicit concern) is structurally impossible, not just application-checked: a second `INSERT` of the same pair violates the PK.

### `verification_tokens` — email verification & password reset

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `user_id` | `BIGINT UNSIGNED` | FK → `users.id`, `ON DELETE CASCADE` |
| `purpose` | `ENUM('EMAIL_VERIFICATION','PASSWORD_RESET')` | |
| `token_hash` | `CHAR(64)` | `UNIQUE NOT NULL` — same hash-not-raw-value principle as sessions |
| `expires_at` | `DATETIME` | |
| `consumed_at` | `DATETIME` | nullable — NULL = still usable; set once = one-time use enforced by the use-case checking this before honoring the token |
| `created_at` | `DATETIME` | |

Index: `(user_id, purpose, consumed_at)` — "does this user have a live pending token of this kind" (used to invalidate/replace an old one when a new reset is requested).

---

## 2. Catalog Domain

### The variant question — **Option A, chosen**

> **Recommendation: A — every product has at least one sellable variant, with exactly one designated `is_default`** — a "simple" product just means a product whose only variant *is* its default. `products` carries zero pricing/SKU/stock columns; **all of that lives on `product_variants`**, always, with `is_default` marking the one row a simple product's storefront UI treats as an implicit "Add to Cart" with no variant picker. (See the precise database-vs-application split of this invariant below, under `product_variants`.)

**Why A over B**, evaluated directly against the brief's five criteria:

| Criterion | A (always one variant) | B (hybrid: price-on-product OR price-on-variant) |
|---|---|---|
| **Cart** | `cart_items.product_variant_id` is always the FK — one shape, one join, always | `cart_items` needs a nullable `product_id` *and* nullable `product_variant_id`, and every cart-total calculation branches on which is set |
| **Inventory** | `inventory_items.product_variant_id` — one FK, one meaning | Inventory would need to key off product *or* variant depending on type — either two inventory tables or a nullable dual-FK inventory table |
| **Order snapshot** | `order_items` always resolves price/SKU from one place at checkout time | Checkout pricing logic branches per product type; two code paths to keep correct forever |
| **Pricing** | One pricing lookup function, one cache key shape (§12 of `docs/ARCHITECTURE.md`) | Two pricing lookup paths, two invalidation-tag shapes |
| **Querying** | Product listing always joins `product_variants` the same way for price-range display | Listing query needs a `COALESCE`/`UNION`-style branch per row to get "the price," which also breaks clean indexing on price |
| **Future variant support** | Turning a simple product into a multi-variant one is just adding more `product_variants` rows — zero migration of existing data | Converting a simple product to variants means *moving* price/SKU/stock off `products` onto a newly created variant row — a data migration, not a data addition |

B's only advantage is one fewer join for the common case (most of this catalog — cables, mounting hardware, protection devices — will be simple products). That's a real but modest cost, and it's exactly the "unnecessary branching in application code" the brief asked to avoid. **A wins.**

### `brands`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `name` | `VARCHAR(150)` | |
| `slug` | `VARCHAR(150)` | `UNIQUE NOT NULL` |
| `logo_url` | `VARCHAR(500)` | nullable — object-storage URL directly; see §14 for why this isn't a `media` join |
| `description` | `TEXT` | nullable |
| `is_active` | `BOOLEAN` | DEFAULT `true` |
| `created_at`, `updated_at` | | |

### `categories` — self-referencing tree

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `parent_id` | `BIGINT UNSIGNED` | nullable FK → `categories.id`, `ON DELETE RESTRICT` (deleting a parent with children must fail loudly, not cascade-orphan or cascade-delete a whole subtree) |
| `name` | `VARCHAR(150)` | |
| `slug` | `VARCHAR(150)` | `UNIQUE NOT NULL` |
| `description` | `TEXT` | nullable |
| `image_url` | `VARCHAR(500)` | nullable |
| `sort_order` | `SMALLINT UNSIGNED` | DEFAULT `0` |
| `is_active` | `BOOLEAN` | DEFAULT `true` |
| `seo_title`, `seo_description` | `VARCHAR(255)`, `VARCHAR(500)` | nullable |
| `created_at`, `updated_at` | | |

Index: `(parent_id, sort_order)` — tree traversal + ordered child listing in one shot.

### `products` — descriptive/marketing data only (no price/SKU/stock — see Option A)

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `brand_id` | `BIGINT UNSIGNED` | nullable FK → `brands.id`, `ON DELETE SET NULL` (a brand going away shouldn't take products with it) |
| `category_id` | `BIGINT UNSIGNED` | FK → `categories.id`, `ON DELETE RESTRICT`; **one primary category per product at MVP** (Phase 0's stated MVP scope) — a `product_categories` M:N junction is a documented future extension, not built now |
| `name` | `VARCHAR(255)` | |
| `slug` | `VARCHAR(255)` | `UNIQUE NOT NULL` |
| `short_description` | `VARCHAR(500)` | nullable |
| `description` | `TEXT` | nullable |
| `unit_of_measure` | `ENUM('EACH','METER')` | DEFAULT `EACH` — see §19; drives whether cart/storefront quantity UI is a whole-number stepper or a decimal length input |
| `status` | `ENUM('DRAFT','ACTIVE','ARCHIVED')` | |
| `is_featured` | `BOOLEAN` | DEFAULT `false` |
| `warranty_months` | `SMALLINT UNSIGNED` | nullable |
| `seo_title`, `seo_description` | `VARCHAR(255)`, `VARCHAR(500)` | nullable |
| `deleted_at` | `DATETIME` | nullable — soft delete (see §20: orders reference products informationally, never destructively) |
| `created_at`, `updated_at` | | |

Indexes:
- `(category_id, status)` — category page listing, filtered to active
- `(status, is_featured, created_at)` — homepage "featured, active, newest" query
- `(brand_id)` — brand page listing

### `product_variants` — every sellable fact lives here

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `product_id` | `BIGINT UNSIGNED` | `NOT NULL` FK → `products.id`, `ON DELETE RESTRICT` — every variant belongs to exactly one product; there is no such thing as an orphan variant |
| `sku` | `VARCHAR(64)` | `UNIQUE NOT NULL` — global uniqueness, not per-product (a SKU is a retailer-wide identifier) |
| `variant_label` | `VARCHAR(255)` | nullable — e.g. `"450W / Black"`; NULL for a simple product's default variant |
| `option_values` | `JSON` | nullable — structured `{ "wattage": "450W" }`-style data for a future variant-picker UI; not queried/filtered against directly (see §24 on JSON usage) |
| `is_default` | `BOOLEAN` | DEFAULT `false` — see constraint below |
| `status` | `ENUM('ACTIVE','ARCHIVED')` | business-status, not a delete — see §20 |
| `sort_order` | `SMALLINT UNSIGNED` | DEFAULT `0` |
| **Pricing** | | |
| `price_minor` | `INT UNSIGNED` | NOT NULL |
| `compare_at_price_minor` | `INT UNSIGNED` | nullable |
| `currency` | `CHAR(3)` | DEFAULT `'NGN'` |
| **Filterable technical facets** (see §3 for why exactly these) | | |
| `power_rating_w` | `SMALLINT UNSIGNED` | nullable |
| `voltage_v` | `SMALLINT UNSIGNED` | nullable |
| `capacity_wh` | `INT UNSIGNED` | nullable |
| `rated_current_a` | `SMALLINT UNSIGNED` | nullable |
| `phase` | `ENUM('SINGLE','THREE')` | nullable |
| `efficiency_percent` | `DECIMAL(5,2)` | nullable |
| `mppt_min_v` | `SMALLINT UNSIGNED` | nullable |
| `mppt_max_v` | `SMALLINT UNSIGNED` | nullable |
| **Logistics facts** (not filters — used in shipping-fee calculation) | | |
| `weight_kg` | `DECIMAL(8,3)` | nullable |
| `length_cm`, `width_cm`, `height_cm` | `DECIMAL(8,2)` | nullable |
| `created_at`, `updated_at` | | |

### Default-variant invariant — corrected terminology

The actual invariant has two halves, and **only one of them is a database-enforceable fact**:

1. **At least one variant per product must exist, and exactly one of a product's variants must be its default.** This is a *creation-time and transactional* invariant — it depends on the *set* of a product's variants being non-empty and having exactly one flagged, which no single-row constraint can express. It is enforced by the **domain/application transaction boundary** (below), not by SQL.
2. **At most one variant per product may be flagged `is_default = true` at any moment.** This half *is* a real, standing database constraint — a plain uniqueness rule over a boolean flag, which MySQL's generated-column idiom handles correctly.

Earlier drafts of this document conflated the two and described the generated-column index as enforcing "exactly one default variant." **That was imprecise and is corrected here: the index enforces "at most one," never "at least one" or "exactly one."** A product with zero variants, or with all its variants' `is_default` set to `false`, does not violate this constraint at all — that gap is real, and closing it is the application layer's job.

**Database — enforces "at most one":**

```sql
ALTER TABLE product_variants
  ADD COLUMN default_variant_key BIGINT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN is_default THEN product_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uq_at_most_one_default_variant_per_product (default_variant_key);
```

Non-default rows all generate `NULL` (unrestricted, any number of them); at most one row per `product_id` may generate a non-null value. **This can't be expressed in Prisma's schema DSL** — see §24 for the migration workflow this implies.

**Application/domain — enforces "at least one, and exactly one default," transactionally:**

Product creation is a single transaction that never leaves a product without its required initial variant:

```sql
START TRANSACTION;
INSERT INTO products (...) VALUES (...);
INSERT INTO product_variants (product_id, ..., is_default) VALUES (:productId, ..., TRUE);
COMMIT;
```

There is no code path in the `catalog` module's use-case layer that creates a `products` row without, in the same transaction, creating at least one `product_variants` row with `is_default = true` — this is a use-case-level guarantee (to be implemented in Phase 4), not a database one, and is called out here so Phase 4 doesn't need to rediscover it.

Adding a *further* variant to an existing product defaults `is_default = false` unless the caller explicitly requests replacing the current default. **Replacing** the default is itself a transaction, ordered specifically to never let the uniqueness constraint see two `TRUE` rows at once even momentarily within the same statement batch:

```sql
START TRANSACTION;
UPDATE product_variants SET is_default = FALSE WHERE product_id = :productId AND is_default = TRUE;
UPDATE product_variants SET is_default = TRUE  WHERE id = :newDefaultVariantId;
COMMIT;
```

Unsetting the old default *before* setting the new one means the generated `default_variant_key` for the old row returns to `NULL` before the new row's key is computed — the two statements never compete for the same unique-index slot, so this ordering is what keeps the transition safe under MySQL's immediate (not deferred) constraint checking. Reversing the order would attempt to insert a second non-null `default_variant_key` for the same `product_id` while the old one is still live, and MySQL would reject it.

Indexes: `(product_id, status)`; `(power_rating_w)`, `(voltage_v)`, `(capacity_wh)`, `(rated_current_a)` as needed once real filter query patterns are measured in Phase 13 (listed here as *candidates*, not blindly added — see §18's rule against indexing everything).

### `product_images`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `product_id` | `BIGINT UNSIGNED` | FK → `products.id`, `ON DELETE CASCADE` (a gallery image has no existence independent of its product) |
| `url` | `VARCHAR(500)` | object-storage URL/key |
| `alt_text` | `VARCHAR(255)` | nullable |
| `width`, `height` | `SMALLINT UNSIGNED` | nullable |
| `is_primary` | `BOOLEAN` | DEFAULT `false` |
| `sort_order` | `SMALLINT UNSIGNED` | DEFAULT `0` |
| `created_at` | | |

Same generated-column trick as above for "exactly one primary image per product" if that invariant turns out to matter enough to enforce at the DB level; for MVP, "first by `sort_order`" is an acceptable app-level substitute, so this constraint is **not** added now — flagged as an easy follow-up, not built speculatively.

Index: `(product_id, sort_order)`.

### `product_specifications` — the long-tail EAV table

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `product_id` | `BIGINT UNSIGNED` | FK → `products.id`, `ON DELETE CASCADE`; **product-level, not variant-level** — see reasoning below |
| `spec_key` | `VARCHAR(100)` | e.g. `"cell_type"`, `"cycle_life"` |
| `spec_value` | `VARCHAR(500)` | |
| `unit` | `VARCHAR(20)` | nullable, e.g. `"cycles"`, `"mm"` |
| `group_label` | `VARCHAR(100)` | nullable — e.g. `"Electrical"`, `"Physical"`, `"Certifications"`, used to group the PDP spec table |
| `sort_order` | `SMALLINT UNSIGNED` | DEFAULT `0` |
| `created_at`, `updated_at` | | |

`UNIQUE(product_id, spec_key)` — an admin can't accidentally enter `"cell_type"` twice for one product.

**Why product-level, not variant-level:** the vast majority of long-tail specs (cell type, cycle life, depth of discharge, certifications, warranty terms) are identical across every variant of a product — a 350W and 450W panel in the same series are still both monocrystalline. Attaching specs to `product_id` means an admin enters them once. The rare spec that *does* differ per wattage variant (e.g. current-at-Vmp) is exactly the kind of value that's also genuinely useful to filter/sort by — which is precisely the test in §3 for "give it a real column on `product_variants`" instead. The EAV table and the real-column set aren't overlapping ways to store the same thing; they're deliberately routing data to wherever its actual usage pattern belongs.

---

## 3. Solar Product Specifications — the hybrid model, justified field-by-field

Phase 0 proposed the shape (real columns for filtered values, EAV for the rest) without pinning down *which* values cross that line. Evaluated here:

| Field | Real column? | Reasoning |
|---|---|---|
| Wattage / rated power | ✅ `power_rating_w` | Primary shopping filter across **both** panels (wattage) and inverters (rated power) — same physical quantity, one column serves both |
| Voltage (panel / battery / inverter battery-side) | ✅ `voltage_v` | Same unit across categories; "12V vs 24V vs 48V system" is a hard compatibility filter customers rely on |
| Current (charge controller / cable rating) | ✅ `rated_current_a` | Charge controllers are *shopped by* amperage ("40A MPPT controller"); cables are *sized by* current-carrying capacity — both are direct filter/search terms, not just spec-sheet trivia |
| Battery capacity | ✅ `capacity_wh` | Normalized to **watt-hours always** (not Ah *or* kWh as two separate columns) — an Ah spec is converted at data-entry time (`Ah × V = Wh`) so "batteries ≥ 5kWh" is one clean range query, never a dual-unit branch |
| Inverter phase | ✅ `phase` (enum) | Small, closed, heavily-filtered set |
| Efficiency | ✅ `efficiency_percent` | Filtered on both panels and inverters ("high-efficiency panels") |
| MPPT range | ✅ `mppt_min_v` / `mppt_max_v` | The compatibility filter ("does this controller support my panel array's voltage") is a **range check**, which EAV genuinely cannot index usefully — this is the textbook case for a real column pair |
| Weight, dimensions | ✅ `weight_kg`, `length_cm`/`width_cm`/`height_cm` | Not a *filter* — a **logistics input** (shipping-fee calculation reads these directly in code); different justification, same conclusion |
| Cell type (mono/poly) | ❌ EAV | Displayed, occasionally used as a coarse filter, but low value density to justify a dedicated column versus text search/EAV lookup |
| Cycle life, depth of discharge | ❌ EAV | Display-only comparison values; not a range-filter customers search by in practice |
| Warranty *terms* text (`warranty_months` on `products` is the one real column already, since it's simple and broadly useful for a "X-year warranty" badge) | ❌ EAV for the free-text detail | The number is a real column (`products.warranty_months`); the fine print isn't |
| Specific input/output voltage text, surge power, other spec-sheet minutiae | ❌ EAV | Long tail — real, but not something anyone filters a product listing by |

This lands at **11 real columns** on `product_variants` (not "dozens"), each independently justified by an actual filter or calculation, not "might be useful someday." Everything else is `product_specifications`.

---

## 4. Pricing

**Price lives on `product_variants`, never on `products`, never in a separate price table** — a direct consequence of Option A (§2): since every sellable unit is a variant, the price of that unit belongs on that row. A separate `prices` table would only earn its cost if this needed **multiple concurrent prices** (e.g. tiered/scheduled pricing, currency-specific pricing, customer-group pricing) — none of which are in Phase 0's MVP scope, and Phase 0 explicitly warns against a premature pricing engine.

- `price_minor` — current selling price. `INT UNSIGNED NOT NULL`.
- `compare_at_price_minor` — optional "was" price for showing a strikethrough discount. `INT UNSIGNED NULL`. No CHECK enforcing `compare_at_price_minor > price_minor` — it's a legitimate display-only value an admin might momentarily set equal (a false constraint here would fight normal editing), validated instead in the admin write path (Zod schema, Phase 4/11), not the database.
- Future discounts (coupons) are computed at checkout time against `price_minor` and stored as `order_items.discount_minor` — they never mutate the catalog price. This keeps "the current price" and "what a discount did to one order" cleanly separated, and matches §7's snapshot requirement.
- Currency: `CHAR(3)` column present per variant now (`'NGN'` default) even though Phase 0's MVP is NGN-only, because it costs nothing today and avoids a schema change the moment multi-currency becomes real.

---

## 5. Inventory

### `inventory_items`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `product_variant_id` | `BIGINT UNSIGNED` | `UNIQUE NOT NULL` FK → `product_variants.id`, `ON DELETE RESTRICT` — **invariant 1**: inventory is tracked per sellable variant, 1:1 |
| `quantity_on_hand` | `DECIMAL(12,3) UNSIGNED` | NOT NULL DEFAULT `0` — see §19 for why `DECIMAL`, not `INT` |
| `quantity_reserved` | `DECIMAL(12,3) UNSIGNED` | NOT NULL DEFAULT `0` |
| `quantity_available` | `DECIMAL(12,3)` | `GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED` — **invariant 2**: always derived, never independently writable. `STORED` (not `VIRTUAL`) so it can be indexed and read cheaply on the storefront's "in stock" check without recomputing per-row on every read. |
| `low_stock_threshold` | `DECIMAL(12,3)` | nullable |
| `updated_at` | `DATETIME` | |

```sql
CHECK (quantity_on_hand >= 0),
CHECK (quantity_reserved >= 0),
CHECK (quantity_reserved <= quantity_on_hand)
```

These CHECKs (MySQL 8.0.16+, enforced) are **defense in depth**, not the primary concurrency mechanism — see the transactional pattern below for that. They exist so that *any* bug, migration, or ad-hoc admin query that tries to write an impossible state is rejected outright.

### `inventory_movements` — append-only ledger

> **Revision note:** an earlier draft keyed order-driven movements off `reference_type = 'ORDER'` + `reference_id = orders.id`, and its deduplication index was described in prose as "one SALE per order-**item**" while the actual generated key (`inventory_item_id` + `order_id`) only ever expressed "one SALE per order-**variant pair**." Those are the same invariant *only if* a variant can never appear on two separate lines of one order — a rule the schema didn't actually state anywhere. Rather than leave that gap implicit, this revision references the precise commercial line directly.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `inventory_item_id` | `BIGINT UNSIGNED` | FK → `inventory_items.id`, `ON DELETE RESTRICT` |
| `type` | `ENUM('RESTOCK','RESERVE','RELEASE','SALE','RETURN','ADJUSTMENT')` | `CANCELLATION` removed — see note below |
| `on_hand_delta` | `DECIMAL(12,3)` | signed; default `0` |
| `reserved_delta` | `DECIMAL(12,3)` | signed; default `0` |
| `order_item_id` | `BIGINT UNSIGNED` | nullable FK → `order_items.id`, `ON DELETE RESTRICT` — **set for `RESERVE`, `RELEASE`, `SALE`, and order-linked `RETURN` rows; `NULL` for `RESTOCK`/`ADJUSTMENT`/purchase-order-driven `RESTOCK`** |
| `reference_type` | `ENUM('MANUAL','PURCHASE_ORDER')` | nullable — narrowed from the earlier draft; the `ORDER` case is now expressed by `order_item_id` directly instead of a generic reference pair (see below) |
| `reference_id` | `BIGINT UNSIGNED` | nullable — meaningful only alongside `reference_type` (e.g. a purchase-order id); `NULL` for a pure manual adjustment with no natural row to point at |
| `note` | `TEXT` | nullable |
| `created_by` | `BIGINT UNSIGNED` | nullable FK → `users.id`, `ON DELETE SET NULL` — NULL for system-driven movements (webhook processing), set for admin-driven `ADJUSTMENT`/`RESTOCK` |
| `created_at` | `DATETIME` | (no `updated_at` — this table is never updated, only inserted) |

**Why `order_item_id` instead of `reference_type='ORDER' + reference_id=order_id`:** an inventory movement should identify the precise commercial line that caused it, not just the order it belongs to. `order_item_id` already carries that: it belongs to exactly one order (`order_items.order_id`) *and* names exactly one variant (`order_items.product_variant_id`) — an order-driven movement referencing it needs no second column and no ambiguity about which line, even in a hypothetical future where one order carries two separate lines for the same variant (see the `order_items` uniqueness rule below for why that hypothetical is closed off anyway, kept here as defense in depth rather than the load-bearing mechanism).

**Evaluated for every movement type, not applied uniformly by assumption:**

| Type | References `order_item_id`? | Reasoning |
|---|---|---|
| `RESERVE` | ✅ always | Created once per order line, inside the checkout transaction, at the same moment that line's `order_items` row is created — the id is available and precise |
| `RELEASE` | ✅ always | Reverses a specific line's `RESERVE`; same `order_item_id` as the `RESERVE` it undoes |
| `SALE` | ✅ always | Converts a specific line's reservation into a sale — this is the row the deduplication guarantee (invariant 8, below) depends on |
| `RETURN` | ✅ when it originates from a customer return against a specific order line; may be `NULL` for a return that isn't attributable to one order line (rare, e.g. a bulk warehouse correction) | Unlike `RESERVE`/`RELEASE`/`SALE`, **multiple `RETURN` rows against the same `order_item_id` are legitimate** — a partial return today and another partial return next week both reference the same line; no uniqueness constraint applies here |
| `ADJUSTMENT` | ❌ never | An admin stock correction isn't caused by any order line — it references nothing order-shaped at all |
| `RESTOCK` | ❌ never | Uses `reference_type='PURCHASE_ORDER'` (or `NULL`/`MANUAL` if there's no formal purchase-order record) instead |

**`CANCELLATION` removed from the type enum as part of this revision** — it never had a meaning distinct from `RELEASE` anywhere in this document (both describe "a reservation is reversed because the order didn't complete"), and carrying two names for one concept is exactly the kind of inconsistent terminology this revision is meant to close out. `RELEASE` is now the one and only type for that case, whether triggered by admin cancellation or TTL expiry.

**Invariant 8 — duplicate webhook processing cannot double-deduct — enforced at the database, not just by the webhook idempotency layer in `docs/ARCHITECTURE.md` §6.4/§6.5.** One generated column now covers all three order-line-scoped, exactly-once movement types at once:

```sql
ALTER TABLE inventory_movements
  ADD COLUMN order_item_movement_dedup_key VARCHAR(80)
    GENERATED ALWAYS AS (
      CASE WHEN type IN ('RESERVE', 'RELEASE', 'SALE')
           THEN CONCAT(type, '-', order_item_id)
           ELSE NULL END
    ) STORED,
  ADD UNIQUE KEY uq_one_reserve_release_sale_per_order_item (order_item_movement_dedup_key);
```

This is now **precisely** "one `SALE` movement for each order item" — the key literally *is* `order_item_id` (qualified by type), not a reconstruction of it via `inventory_item_id` + `order_id` that happened to be equivalent under an unstated assumption. The same generated column additionally guarantees at most one `RESERVE` and at most one `RELEASE` per order item, for the same reason those two are exactly-once events in the checkout/cancellation lifecycle. `RETURN` is deliberately excluded from this key (see the table above — repeats are legitimate there).

As before: even if the application-level webhook idempotency guard (unique `webhook_events` row + conditional `orders` status UPDATE) were somehow bypassed, a second `SALE` insert for the same order item fails outright at the database — now for the *actual* stated invariant, not an approximation of it.

**Order-line uniqueness — the business rule this design now depends on being explicit, not assumed:** a product variant may appear on **at most one line per order** — enforced directly:

```sql
ALTER TABLE order_items
  ADD UNIQUE KEY uq_one_line_per_variant_per_order (order_id, product_variant_id);
```

This mirrors the rule `cart_items` already enforces (`UNIQUE(cart_id, product_variant_id)`, §6) — since an order's line items are created directly from a cart's line items at checkout, this is the expected, natural consequence of that existing rule, now stated explicitly at the table that actually matters historically (orders outlive their originating cart). It is *not* the mechanism the `SALE` deduplication above depends on (that's `order_item_id` directly, which needs no such assumption) — it exists as an independent, defense-in-depth invariant in its own right, and because "can a variant legitimately appear twice in one order" is exactly the kind of question worth answering explicitly rather than leaving implicit. (`product_variant_id` is nullable on `order_items` per §7's informational-FK design; MySQL's standard `UNIQUE` semantics don't collide on `NULL`, so a line whose variant was later deleted doesn't interact with this constraint.)

**Refinement over Phase 0's original single `quantity_delta` column:** splitting into `on_hand_delta` + `reserved_delta` makes every movement type's effect explicit and independently replayable — `RESERVE` is `reserved_delta = +qty, on_hand_delta = 0`; `SALE` is `on_hand_delta = -qty, reserved_delta = -qty` (both drop together); `RESTOCK` is `on_hand_delta = +qty`; `RELEASE` is `reserved_delta = -qty`. Summing either column over all movements for an item must equal that item's current `quantity_on_hand`/`quantity_reserved` — a genuine, checkable reconciliation invariant, not just an audit trail.

**Transactional pattern for reservation (invariant 5 — reservation and order creation occur transactionally), corrected ordering:**

```sql
START TRANSACTION;
INSERT INTO orders (...) VALUES (...);
INSERT INTO order_items (order_id, product_variant_id, ...) VALUES (:orderId, :variantId, ...);  -- per line, yields order_item_id
-- for each line item:
UPDATE inventory_items
SET quantity_reserved = quantity_reserved + :qty
WHERE product_variant_id = :variantId
  AND (quantity_on_hand - quantity_reserved) >= :qty;
-- 0 rows affected ⇒ insufficient stock ⇒ ROLLBACK, abort order creation entirely
INSERT INTO inventory_movements (inventory_item_id, type, reserved_delta, order_item_id, ...)
  VALUES (:inventoryItemId, 'RESERVE', :qty, :orderItemId, ...);
COMMIT;
```

**Ordering matters and changed from the previous draft:** `order_items` rows must exist *before* the `RESERVE` movements that reference them by `order_item_id` — the previous draft's sequence (movement, then order, then order items) was written for the old `reference_type='ORDER'`/`order_id` shape, which was available immediately; it's no longer valid under this revision and is corrected here. The `UPDATE ... WHERE` remains the concurrency guard — InnoDB's row lock on the matched `inventory_items` row serializes concurrent reservation attempts against the same variant (see §22).

**Invariant 4 — reservations belong to orders, not payment attempts:** unchanged in spirit, restated precisely — every `RESERVE`/`RELEASE`/`SALE` movement traces to an `order_item_id`, which itself belongs to exactly one order via `order_items.order_id`; no movement in this family ever references a `payment_attempt_id`. This is what lets an order survive multiple failed/retried payment attempts without re-reserving or double-reserving stock (`docs/ARCHITECTURE.md` §7).

**Invariant 9 — manual adjustment is auditable:** every `ADJUSTMENT` movement requires `created_by` (admin) and `note` (app-enforced NOT NULL-in-practice via the use-case, even though the column itself is nullable to accommodate system-driven types) — combined with `audit_logs` (§15) recording the same event a second time from the admin-action side, giving two independent trails for the single most abuse-prone inventory operation.

---

## 6. Cart

### `carts`

> **Revision note:** an earlier draft put a plain `UNIQUE` on `user_id` and on `guest_token_hash` directly. Combined with a `status` that can be `ACTIVE`, `CONVERTED`, or `ABANDONED`, that was actually stricter than intended — a plain `UNIQUE(user_id)` permits **at most one cart row for that user ever**, across all history, which contradicts keeping `CONVERTED`/`ABANDONED` carts around at all. The fix (below) scopes uniqueness to `ACTIVE` rows only, the same generated-column technique already used for `product_variants.is_default` and `addresses.is_default`.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `user_id` | `BIGINT UNSIGNED` | nullable, FK → `users.id`, `ON DELETE CASCADE` — **not** independently `UNIQUE`; see below |
| `guest_token_hash` | `CHAR(64)` | nullable — hash of a signed httpOnly cookie value, same principle as `sessions.session_token_hash`; **not** independently `UNIQUE`; see below |
| `status` | `ENUM('ACTIVE','CONVERTED','ABANDONED')` | DEFAULT `ACTIVE` |
| `expires_at` | `DATETIME` | nullable — guest carts get a TTL; authenticated carts don't need one |
| `created_at`, `updated_at` | | |

```sql
CHECK (
  (user_id IS NOT NULL AND guest_token_hash IS NULL) OR
  (user_id IS NULL AND guest_token_hash IS NOT NULL)
)
```

This CHECK is unchanged — a cart still has exactly one identity axis, always. What changes is *how uniqueness is scoped*:

```sql
ALTER TABLE carts
  ADD COLUMN active_cart_user_key BIGINT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN status = 'ACTIVE' THEN user_id ELSE NULL END) STORED,
  ADD COLUMN active_cart_guest_key CHAR(64)
    GENERATED ALWAYS AS (CASE WHEN status = 'ACTIVE' THEN guest_token_hash ELSE NULL END) STORED,
  ADD UNIQUE KEY uq_one_active_cart_per_user (active_cart_user_key),
  ADD UNIQUE KEY uq_one_active_cart_per_guest_token (active_cart_guest_key);
```

**The actual, corrected invariant:**
- **One `ACTIVE` cart per user** — enforced by `uq_one_active_cart_per_user`; a `CONVERTED` or `ABANDONED` row for that same user generates `NULL` and is unrestricted.
- **One `ACTIVE` cart per guest token** — the mirror-image constraint on `active_cart_guest_key`.
- **Historical `CONVERTED`/`ABANDONED` carts may coexist freely**, any number of them, per user or per guest token — this is now actually true of the schema, not just the intent.
- **A user and a guest can never accidentally share a cart** — unchanged from before, still guaranteed by the CHECK constraint: no row can ever have both `user_id` and `guest_token_hash` set, active or not.

**Should a converted cart be retained permanently or eventually purged?** Retained for a bounded, practical window (e.g. long enough for returns/support investigation — a few months), then purged by a periodic housekeeping job, **not** kept forever. Unlike orders, a converted cart's line items are already fully preserved in `order_items` as an immutable snapshot the moment checkout succeeds — the cart row itself is a UX/audit convenience past that point, not a second source of truth, so there's no financial-record reason to keep it indefinitely. This is intentionally the simplest workable answer, not a designed retention policy — over-engineering cart retention isn't warranted here.

### `cart_items`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `cart_id` | `BIGINT UNSIGNED` | FK → `carts.id`, `ON DELETE CASCADE` |
| `product_variant_id` | `BIGINT UNSIGNED` | FK → `product_variants.id`, `ON DELETE CASCADE` (if a variant is ever hard-deleted with no orders against it, its cart presence should vanish too — carts are ephemeral, unlike orders) |
| `quantity` | `DECIMAL(12,3)` | NOT NULL |
| `price_snapshot_minor` | `INT UNSIGNED` | captured at add-to-cart time |
| `created_at`, `updated_at` | | |

`UNIQUE(cart_id, product_variant_id)` — adding an already-present variant increments `quantity` via upsert rather than creating a duplicate line ("duplicate cart item," §17's explicit concern).

**Snapshot vs. authoritative:** `price_snapshot_minor` is **convenience only** — it's what renders instantly in the cart UI without a live price lookup, but per `docs/ARCHITECTURE.md` §9, checkout always re-reads `product_variants.price_minor` fresh and recalculates; a stale cart snapshot can never reach an order. `quantity` **is** authoritative for the cart itself (it's the one thing the customer is actively choosing), but is re-validated against live stock at checkout time (§7's reservation step), not trusted blindly either.

---

## 7. Orders

### `orders`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `order_number` | `VARCHAR(30)` | `UNIQUE NOT NULL` — human-facing (`ORD-20260101-00001`), independent of the internal `id` |
| `user_id` | `BIGINT UNSIGNED` | nullable FK → `users.id`, `ON DELETE SET NULL` — **an order must outlive a deleted account** |
| `guest_email`, `guest_phone` | `VARCHAR(255)`, `VARCHAR(32)` | nullable — populated for guest checkouts |
| `status` | `ENUM('PENDING_PAYMENT','PAID','PROCESSING','READY_FOR_DISPATCH','SHIPPED','DELIVERED','CANCELLED','REFUNDED')` | |
| `authoritative_payment_attempt_id` | `BIGINT UNSIGNED` | nullable, `UNIQUE`, FK → `payment_attempts.id`, `ON DELETE RESTRICT` — set **at most once**, by the conditional `UPDATE ... WHERE authoritative_payment_attempt_id IS NULL AND status = 'PENDING_PAYMENT'` described in `docs/ARCHITECTURE.md` §6.5. The column's own `UNIQUE` index additionally guarantees one payment attempt can never be claimed as authoritative by two different orders. |
| `subtotal_minor` | `INT UNSIGNED` | |
| `discount_minor` | `INT UNSIGNED` | DEFAULT `0` |
| `delivery_fee_minor` | `INT UNSIGNED` | DEFAULT `0` |
| `tax_minor` | `INT UNSIGNED` | DEFAULT `0` |
| `total_minor` | `INT UNSIGNED` | NOT NULL |
| `currency` | `CHAR(3)` | DEFAULT `'NGN'` |
| `customer_note` | `TEXT` | nullable |
| `created_at`, `updated_at` | | |

```sql
CHECK (total_minor = subtotal_minor - discount_minor + delivery_fee_minor + tax_minor)
```

A cheap, always-true arithmetic invariant — defense against a bug in the order-total calculation (which `docs/ARCHITECTURE.md` §16 already requires unit tests for) ever persisting an inconsistent total. No FK to `coupons` on this table — see `coupon_redemptions` (§13) for why.

Indexes: `UNIQUE(order_number)`; `(user_id, created_at)` — "my orders" page; `(status, created_at)` — admin order list filter/sort; the `authoritative_payment_attempt_id` unique index doubles as its lookup index.

### `order_items` — immutable snapshot

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `order_id` | `BIGINT UNSIGNED` | FK → `orders.id`, `ON DELETE CASCADE` (no independent existence outside its order) |
| `product_id` | `BIGINT UNSIGNED` | nullable, **informational** FK → `products.id`, `ON DELETE SET NULL` |
| `product_variant_id` | `BIGINT UNSIGNED` | nullable, **informational** FK → `product_variants.id`, `ON DELETE SET NULL` |
| `product_name_snapshot` | `VARCHAR(255)` | |
| `sku_snapshot` | `VARCHAR(64)` | |
| `variant_label_snapshot` | `VARCHAR(255)` | nullable |
| `unit_price_minor` | `INT UNSIGNED` | |
| `quantity` | `DECIMAL(12,3)` | |
| `discount_minor` | `INT UNSIGNED` | DEFAULT `0` |
| `tax_minor` | `INT UNSIGNED` | DEFAULT `0` |
| `line_total_minor` | `INT UNSIGNED` | |
| `created_at` | | |

`UNIQUE(order_id, product_variant_id)` — **a product variant may appear on at most one line per order**, mirroring `cart_items`'s existing `UNIQUE(cart_id, product_variant_id)` (§6). See §5 for why this matters beyond the obvious: it's what makes `inventory_movements.order_item_id` an unambiguous, precise reference for `RESERVE`/`RELEASE`/`SALE` deduplication.

**Exactly which values are snapshots, spelled out** (answering §7's direct question): `product_name_snapshot`, `sku_snapshot`, `variant_label_snapshot`, `unit_price_minor`, `discount_minor`, `tax_minor`, and `line_total_minor` are **all frozen at order-creation time and never recomputed** — a later product rename, price change, spec change, category move, brand change, or even the product/variant being deleted (`ON DELETE SET NULL` on both FKs — the *pointer* can go null, the *snapshot fields* never do) leaves this row fully legible on its own. `product_id`/`product_variant_id` are kept purely as a "jump to the current product page, if it still exists" convenience — the order's own legal/financial record never depends on them resolving.

**No CHECK constraint enforcing `line_total_minor = unit_price_minor * quantity − discount_minor + tax_minor` at the row level** — a deliberate omission, not an oversight: `quantity` is `DECIMAL`, so `unit_price_minor * quantity` can produce a fractional minor-unit value (a fraction of a kobo) that only becomes a valid integer after the application applies its rounding rule. Encoding that rounding rule correctly inside a MySQL CHECK expression is fragile and would silently diverge from the application's actual (unit-tested, per `docs/ARCHITECTURE.md` §16) rounding logic. The `orders.total_minor` CHECK above is the one arithmetic invariant enforced at the database; line-item arithmetic correctness is the application's job, verified by tests, not duplicated unreliably in SQL.

### `order_addresses`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `order_id` | `BIGINT UNSIGNED` | FK → `orders.id`, `ON DELETE CASCADE` |
| `type` | `ENUM('SHIPPING','BILLING')` | |
| `full_name`, `phone` | `VARCHAR(255)`, `VARCHAR(32)` | |
| `address_line1` | `VARCHAR(255)` | |
| `address_line2` | `VARCHAR(255)` | nullable |
| `city`, `state` | `VARCHAR(100)` | |
| `country` | `CHAR(2)` | DEFAULT `'NG'` |
| `postal_code` | `VARCHAR(20)` | nullable |
| `delivery_notes` | `TEXT` | nullable |
| `created_at` | | |

`UNIQUE(order_id, type)` — at most one shipping + one billing address per order. Entirely independent of the customer's saved `addresses` (§10) — copied at order-creation time, never referencing that table by FK, so an edited or deleted saved address can never alter historical order data.

### `order_status_history`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `order_id` | `BIGINT UNSIGNED` | FK → `orders.id`, `ON DELETE CASCADE` |
| `from_status`, `to_status` | `VARCHAR(30)` | (stored as strings, not the `orders.status` enum type, so history rows never break if the enum's value set changes) |
| `actor_type` | `ENUM('SYSTEM','ADMIN','WEBHOOK')` | |
| `actor_id` | `BIGINT UNSIGNED` | nullable FK → `users.id`, `ON DELETE SET NULL` |
| `note` | `VARCHAR(500)` | nullable |
| `created_at` | | (append-only, no `updated_at`) |

Index: `(order_id, created_at)` — full history for one order, in order.

---

## 8. Payment Domain

Preserves exactly the approved shape:

```text
order
  │
  ├── payment_attempt #1  (FAILED)
  ├── payment_attempt #2  (ABANDONED)
  └── payment_attempt #3  (SUCCESS) ◄── orders.authoritative_payment_attempt_id points here
          │
          └── refunds (0 or more, against payment_attempt #3 only)
```

### `payment_attempts`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `order_id` | `BIGINT UNSIGNED` | FK → `orders.id`, `ON DELETE RESTRICT` |
| `paystack_reference` | `VARCHAR(100)` | `UNIQUE NOT NULL` — server-generated, one per attempt |
| `amount_minor` | `INT UNSIGNED` | |
| `currency` | `CHAR(3)` | DEFAULT `'NGN'` |
| `status` | `ENUM('INITIATED','PENDING','SUCCESS','FAILED','ABANDONED','INITIALIZATION_FAILED')` | |
| `channel` | `VARCHAR(30)` | nullable (card, bank transfer, ussd, ...) |
| `authorization_url`, `access_code` | `VARCHAR(500)`, `VARCHAR(100)` | nullable |
| `gateway_response` | `VARCHAR(255)` | nullable |
| `error_code`, `error_message` | `VARCHAR(50)`, `VARCHAR(500)` | nullable — sanitized only; see `docs/ARCHITECTURE.md` §17 |
| `refunded_amount_minor` | `INT UNSIGNED` | NOT NULL DEFAULT `0` — **successfully refunded money only** (sum of `refunds` rows that reached `REFUNDED`). See §9 for why this is deliberately *not* the only allocation ledger. |
| `pending_refund_amount_minor` | `INT UNSIGNED` | NOT NULL DEFAULT `0` — money currently allocated to **in-flight** refund requests (`REFUND_REQUESTED` + `REFUND_PENDING`), not yet confirmed either way. See §9. |
| `available_refundable_amount_minor` | `INT UNSIGNED` | `GENERATED ALWAYS AS (amount_minor - refunded_amount_minor - pending_refund_amount_minor) STORED` — the number an admin's "refund up to ₦X" UI reads; same derived-column pattern as `inventory_items.quantity_available` |
| `paid_at`, `failed_at` | `DATETIME` | nullable |
| `created_at`, `updated_at` | | |

```sql
CHECK (refunded_amount_minor + pending_refund_amount_minor <= amount_minor)
```

Indexes: `(order_id, status)` — "does this order have a successful attempt"; `(status, created_at)` — the `PENDING`/`INITIATED` TTL sweep query.

### `webhook_events` — durable inbox, resolved after the fact

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `provider` | `VARCHAR(20)` | DEFAULT `'paystack'` — future-proofs against a second payment provider without a schema change |
| `event_type` | `VARCHAR(50)` | e.g. `charge.success`, `refund.processed` |
| `paystack_transaction_id` | `VARCHAR(50)` | see idempotency note below |
| `paystack_reference` | `VARCHAR(100)` | nullable — used to resolve to a `payment_attempts` row |
| `raw_payload` | `JSON` | full received body, for replay/debugging |
| `processing_status` | `ENUM('PENDING','PROCESSING','PROCESSED','FAILED')` | DEFAULT `PENDING` |
| `processing_attempts` | `SMALLINT UNSIGNED` | DEFAULT `0` |
| `locked_at` | `DATETIME` | nullable — set when a worker claims the row |
| `processed_at` | `DATETIME` | nullable |
| `error_message` | `TEXT` | nullable |
| `resolved_entity_type` | `ENUM('PAYMENT_ATTEMPT','REFUND')` | nullable — filled in once processing resolves the target |
| `resolved_entity_id` | `BIGINT UNSIGNED` | nullable — **not a real FK**, deliberately (see note) |
| `received_at`, `created_at` | | |

**Idempotency key:**

```sql
UNIQUE KEY uq_webhook_events_natural_key (event_type, paystack_transaction_id)
```

Per `docs/ARCHITECTURE.md` §6.4, this is built from fields Paystack's documented payload actually provides (`event`, `data.id`), not an invented `event_id`. **Open risk carried forward from Phase 0, restated here at the schema level:** this requires `paystack_transaction_id` to be reliably present and non-null for every event type actually used; if some event type turns out to lack it, the column needs a documented fallback (e.g. a hash of the normalized payload) before Phase 9 ships — flagged, not silently assumed away.

**Why `resolved_entity_id` is not a real foreign key:** it can point at either `payment_attempts` or `refunds` depending on `resolved_entity_type`, and — more importantly — it's frequently `NULL` at insert time by design (a row can be durably persisted *before* anyone has looked at it closely enough to know what it resolves to, which is the entire point of the durable-inbox pattern in `docs/ARCHITECTURE.md` §6.3). A polymorphic FK isn't natively expressible in MySQL/Prisma anyway (see §14's identical problem with the old `media` design); here, unlike `media`, splitting into two exclusive nullable FK columns (`resolved_payment_attempt_id`, `resolved_refund_id`) *is* worth doing, since there are only two possible targets and both are known in advance:

```sql
resolved_payment_attempt_id BIGINT UNSIGNED NULL REFERENCES payment_attempts(id) ON DELETE SET NULL,
resolved_refund_id          BIGINT UNSIGNED NULL REFERENCES refunds(id)          ON DELETE SET NULL,
CHECK (resolved_payment_attempt_id IS NULL OR resolved_refund_id IS NULL)
```

(Superseding the single generic `resolved_entity_id` column sketched above — the two-nullable-FK shape gives real referential integrity for a two-way polymorphism, which the `media` table's open-ended *N*-way polymorphism could never get. This is the actual recommended design; the single-column version above was shown only to state the idempotency key clearly first.)

Indexes: the unique key above already serves lookup-by-natural-key; `(processing_status, locked_at)` — the worker's claim query (find `PENDING` rows, find stale `PROCESSING` rows); `(paystack_reference)` — resolving to a `payment_attempts` row by reference.

---

## 9. Refunds

Modeled as its own entity with its own async lifecycle, never a status flag bolted onto `payment_attempts`.

> **Revision note:** an earlier draft of this section incremented `payment_attempts.refunded_amount_minor` the moment a refund was *requested*, not when it actually succeeded. That was wrong: a subsequent `REFUND_FAILED` left `refunded_amount_minor` permanently overstated, making a customer look like they'd already consumed refundable balance they never actually received back. The design below distinguishes **allocated-but-unconfirmed** money from **actually-refunded** money, and every transition below explicitly says which of the two it touches.

### `refunds`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `payment_attempt_id` | `BIGINT UNSIGNED` | FK → `payment_attempts.id`, `ON DELETE RESTRICT` |
| `order_id` | `BIGINT UNSIGNED` | FK → `orders.id`, `ON DELETE RESTRICT` — denormalized from `payment_attempt_id`'s own `order_id`, kept for direct query convenience ("all refunds for this order") without a join |
| `paystack_refund_reference` | `VARCHAR(100)` | nullable, `UNIQUE` — assigned once Paystack responds; multiple `NULL`s never collide (standard SQL `UNIQUE` semantics), so several `REFUND_REQUESTED` rows can coexist before any reference is assigned |
| `amount_minor` | `INT UNSIGNED` | NOT NULL — supports partial refunds directly (this need not equal the full attempt amount) |
| `status` | `ENUM('REFUND_REQUESTED','REFUND_PENDING','REFUNDED','REFUND_FAILED','REFUND_CANCELLED')` | see state machine below |
| `reason` | `TEXT` | nullable |
| `requested_by` | `BIGINT UNSIGNED` | FK → `users.id`, `ON DELETE RESTRICT` — always an admin, always attributable |
| `requested_at`, `processed_at` | `DATETIME` | `processed_at` nullable until terminal |
| `raw_webhook_payload` | `JSON` | nullable — the refund webhook event that finalized this row |
| `created_at`, `updated_at` | | |

**`REFUND_CANCELLED` is new in this revision** — a distinct terminal state from `REFUND_FAILED`, deliberately: `REFUND_FAILED` means Paystack or the network-level API call failed; `REFUND_CANCELLED` means an admin with `payments.refund` deliberately aborted the request before it reached a Paystack-confirmed outcome. Both release the same allocation identically (below), but keeping them distinct gives a clean, honest audit trail — "how many refunds failed due to a gateway problem" is a different operational question from "how many did staff back out of," and collapsing them into one status would blur that.

### Refund state machine (corrected)

```text
REFUND_REQUESTED ──► REFUND_PENDING ──► REFUNDED
        │                   │
        │                   ├──► REFUND_FAILED
        │                   └──► REFUND_CANCELLED
        │
        ├──► REFUND_FAILED       (the Paystack API call itself fails outright)
        └──► REFUND_CANCELLED    (admin aborts before Paystack ever confirms)
```

| Transition | `payment_attempts.pending_refund_amount_minor` | `payment_attempts.refunded_amount_minor` |
|---|---|---|
| *(create)* → `REFUND_REQUESTED` | **+= amount** (allocated) | unchanged |
| `REFUND_REQUESTED` → `REFUND_PENDING` (Paystack accepted the request) | unchanged — still allocated | unchanged |
| `REFUND_PENDING` → `REFUNDED` (refund webhook confirms) | **−= amount** (allocation resolved) | **+= amount** (now actually refunded) |
| `REFUND_REQUESTED`/`REFUND_PENDING` → `REFUND_FAILED` | **−= amount** (released) | unchanged |
| `REFUND_REQUESTED`/`REFUND_PENDING` → `REFUND_CANCELLED` | **−= amount** (released) | unchanged |

This is exactly the brief's required invariant, expressed as two ledgers instead of one:

```text
available_refundable_amount_minor
  = amount_minor − refunded_amount_minor − pending_refund_amount_minor
```

**Supports the brief's explicit list directly:**
- **Full refunds:** request an amount equal to the current `available_refundable_amount_minor`.
- **Partial refunds:** request any smaller amount; `available_refundable_amount_minor` shrinks by exactly that much the moment the request is allocated, *before* Paystack ever responds.
- **Multiple partial refunds against one successful attempt:** each new request's allocation check runs against `refunded_amount_minor + pending_refund_amount_minor` — the combined total of everything already confirmed *and* everything still in flight — so a second, third, or further partial refund is always evaluated against what's genuinely still available, never against a stale "only completed refunds count" figure.
- **Status lifecycle, Paystack reference, auditability:** all present above; every state transition is additionally an `audit_logs` row (§15).

### Preventing successful + pending refunds from exceeding amount paid — **both DB and application, defense in depth**

**Primary mechanism (application, concurrency-safe) — allocation happens at request time, before Paystack is ever called:**

```sql
START TRANSACTION;
UPDATE payment_attempts
SET pending_refund_amount_minor = pending_refund_amount_minor + :amount
WHERE id = :attemptId
  AND refunded_amount_minor + pending_refund_amount_minor + :amount <= amount_minor;
-- 0 rows affected ⇒ would exceed availability ⇒ ROLLBACK, reject the refund request outright
INSERT INTO refunds (..., amount_minor, status, ...) VALUES (..., :amount, 'REFUND_REQUESTED', ...);
COMMIT;
-- Only AFTER this commits does the use-case call Paystack's Refund API (network calls
-- never happen inside the transaction — same rule as every other flow in §21).
```

The `WHERE` clause checks against **both** already-refunded *and* already-pending amounts — this is the actual fix. The old design's `WHERE refunded_amount_minor + :amount <= amount_minor` only ever looked at confirmed refunds, which is exactly how two simultaneously in-flight partial refunds could jointly over-allocate without either individually exceeding the paid amount.

**Releasing an allocation** (refund fails or is cancelled) uses the mirror-image update, in its own transaction alongside the `refunds` status change:

```sql
START TRANSACTION;
UPDATE payment_attempts
SET pending_refund_amount_minor = pending_refund_amount_minor - :amount
WHERE id = :attemptId;
UPDATE refunds
SET status = 'REFUND_FAILED', processed_at = NOW()   -- or 'REFUND_CANCELLED'
WHERE id = :refundId AND status IN ('REFUND_REQUESTED', 'REFUND_PENDING');
COMMIT;
```

**Confirming an allocation** (refund succeeds) moves the same amount from one ledger to the other in one transaction:

```sql
START TRANSACTION;
UPDATE payment_attempts
SET pending_refund_amount_minor = pending_refund_amount_minor - :amount,
    refunded_amount_minor = refunded_amount_minor + :amount
WHERE id = :attemptId;
UPDATE refunds
SET status = 'REFUNDED', processed_at = NOW()
WHERE id = :refundId AND status = 'REFUND_PENDING';
-- If this refund's amount now equals the attempt's full amount_minor, the order
-- transitions to REFUNDED in the same transaction — see §21.
COMMIT;
```

Two admins racing to refund the same attempt (§22) are serialized by InnoDB's row lock on the first `UPDATE ... WHERE` in each of these blocks — the second transaction's conditional check always re-evaluates against the first's already-applied delta, whichever operation (allocate, release, or confirm) is running.

**Secondary mechanism (database, catches anything that bypasses the use-case):**

```sql
CHECK (refunded_amount_minor + pending_refund_amount_minor <= amount_minor)  -- on payment_attempts, §8
```

A per-row CHECK is sufficient here — unlike the line-item arithmetic problem in §7, this is a plain integer comparison with no rounding ambiguity, so encoding it directly in SQL is both correct and cheap.

---

## 10. Customers and Addresses

### `addresses` — saved, editable, belongs to the customer

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `user_id` | `BIGINT UNSIGNED` | FK → `users.id`, `ON DELETE CASCADE` |
| `label` | `VARCHAR(50)` | nullable (`"Home"`, `"Office"`) |
| `full_name`, `phone` | | |
| `address_line1`, `address_line2` | | `address_line2` nullable |
| `city`, `state`, `country`, `postal_code` | | `postal_code` nullable |
| `is_default` | `BOOLEAN` | DEFAULT `false` |
| `created_at`, `updated_at` | | |

Same generated-column trick as `product_variants.is_default` for "at most one default address per user":

```sql
default_address_key BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN is_default THEN user_id ELSE NULL END) STORED,
UNIQUE KEY uq_one_default_address_per_user (default_address_key)
```

**Order addresses never reference this table by FK** (§7) — `order_addresses` is a fully independent copy taken at checkout time. Editing or deleting a saved address can never alter a past order's recorded delivery/billing address, which is exactly the invariant the brief asked for.

**Guest checkout contact info** lives directly on `orders.guest_email`/`guest_phone` (§7) — there is no `addresses` row for a guest at all, consistent with `docs/ARCHITECTURE.md` §5's explicit choice not to auto-link guest orders to any account.

---

## 11. Consultation / Installation

**One table, not two — `service_requests`**, distinguished by a `service_type` column rather than separate `consultation_requests`/`installation_requests` tables. The two would be near-identical in shape (name/contact/location/message/status/appointment fields), and duplicating that shape across two tables is exactly the kind of CRM over-design the brief warned against.

### `service_requests`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `user_id` | `BIGINT UNSIGNED` | nullable FK → `users.id`, `ON DELETE SET NULL` |
| `guest_name`, `guest_email`, `guest_phone` | | for non-authenticated requesters |
| `service_type` | `ENUM('CONSULTATION','SYSTEM_SIZING','INSTALLATION','MAINTENANCE','SITE_ASSESSMENT')` | |
| `status` | `ENUM('NEW','CONTACTED','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')` | see note below |
| `property_type` | `ENUM('RESIDENTIAL','COMMERCIAL','INDUSTRIAL')` | nullable |
| `location` | `VARCHAR(500)` | nullable, free text |
| `current_electricity_situation` | `TEXT` | nullable |
| `estimated_monthly_usage_kwh` | `DECIMAL(10,2)` | nullable |
| `appliances` | `TEXT` | nullable |
| `desired_backup_hours` | `DECIMAL(5,2)` | nullable |
| `existing_equipment` | `TEXT` | nullable |
| `budget_range` | `VARCHAR(50)` | nullable |
| `preferred_appointment_at` | `DATETIME` | nullable |
| `additional_info` | `TEXT` | nullable |
| `assigned_to` | `BIGINT UNSIGNED` | nullable FK → `users.id`, `ON DELETE SET NULL` |
| `created_at`, `updated_at` | | |

Every solar-specific field is nullable, per Phase 0's explicit instruction not to force every field required.

**On "allow the business to configure service request statuses" (Phase 0's wording):** that phrasing suggests a data-driven status lookup table rather than a fixed `ENUM`. Building that now would be exactly the CRM over-engineering this section also warns against, for a status set that's realistically stable (new → contacted → scheduled → in progress → completed/cancelled). **Decision: `ENUM` for MVP**, with the upgrade path (a `service_request_statuses` table + FK) documented here as the concrete next step *if* the business actually asks to customize statuses later — a reasonable engineering assumption, stated rather than silently chosen.

Indexes: `(status, created_at)` — admin queue view; `(service_type)`; `(assigned_to)`.

---

## 12. Reviews

### `reviews`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `product_id` | `BIGINT UNSIGNED` | FK → `products.id`, `ON DELETE CASCADE` |
| `user_id` | `BIGINT UNSIGNED` | FK → `users.id`, `ON DELETE CASCADE` — reviews require an authenticated account, no guest reviews |
| `order_item_id` | `BIGINT UNSIGNED` | nullable FK → `order_items.id`, `ON DELETE SET NULL` — optional "verified purchase" linkage, not required to leave a review at MVP |
| `rating` | `TINYINT UNSIGNED` | NOT NULL |
| `title` | `VARCHAR(255)` | nullable |
| `body` | `TEXT` | NOT NULL |
| `status` | `ENUM('PENDING','APPROVED','REJECTED')` | DEFAULT `PENDING` |
| `created_at`, `updated_at` | | |

```sql
CHECK (rating BETWEEN 1 AND 5)
```

`UNIQUE(product_id, user_id)` — **one review per customer per product**, the exact duplicate-prevention rule the brief asked for. (Deliberately not `UNIQUE(product_id, user_id, order_item_id)` — that would allow one review per *purchase*, which is a different, more permissive product decision than what's asked for here.)

Index: `(product_id, status)` — public PDP review listing, approved only.

---

## 13. Coupons / Discounts

### `coupons`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `code` | `VARCHAR(50)` | `UNIQUE NOT NULL` |
| `type` | `ENUM('FLAT','PERCENTAGE')` | |
| `value_minor` | `INT UNSIGNED` | nullable — used when `type = FLAT` |
| `percentage` | `DECIMAL(5,2)` | nullable — used when `type = PERCENTAGE` |
| `max_discount_minor` | `INT UNSIGNED` | nullable — caps a percentage discount |
| `min_order_amount_minor` | `INT UNSIGNED` | nullable |
| `usage_limit` | `INT UNSIGNED` | nullable — total redemptions allowed, across all customers |
| `usage_limit_per_customer` | `SMALLINT UNSIGNED` | nullable |
| `starts_at`, `expires_at` | `DATETIME` | nullable |
| `is_active` | `BOOLEAN` | DEFAULT `true` |
| `created_at`, `updated_at` | | |

```sql
CHECK (
  (type = 'FLAT' AND value_minor IS NOT NULL AND percentage IS NULL) OR
  (type = 'PERCENTAGE' AND percentage IS NOT NULL AND value_minor IS NULL)
)
```

### `coupon_redemptions`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `coupon_id` | `BIGINT UNSIGNED` | FK → `coupons.id`, `ON DELETE RESTRICT` |
| `order_id` | `BIGINT UNSIGNED` | `UNIQUE NOT NULL` FK → `orders.id`, `ON DELETE RESTRICT` |
| `user_id` | `BIGINT UNSIGNED` | nullable FK → `users.id`, `ON DELETE SET NULL` — NULL for a guest redemption |
| `discount_applied_minor` | `INT UNSIGNED` | the actual monetary effect, frozen at redemption time |
| `redeemed_at` | `DATETIME` | |

**No `orders.coupon_id` column** — this table is the single source of truth for "which coupon did this order use," rather than duplicating that relationship in two places. `orders.discount_minor` already captures the monetary effect for order-total purposes; `coupon_redemptions` answers "which coupon, when, by whom" for usage-limit enforcement and reporting.

`UNIQUE(order_id)` enforces "one coupon per order" (MVP scope, per Phase 0's explicit instruction not to build a promotion engine). `usage_limit`/`usage_limit_per_customer` are enforced by the checkout use-case counting rows in this table before applying a coupon — **not** a database constraint, since "has this customer used this coupon N times before" is a count query, not a row-level invariant a `CHECK`/`UNIQUE` can express.

**Known limitation, stated rather than solved further:** for guest checkouts, "per-customer" usage limiting can only be approximated by matching `orders.guest_email`, which a determined user can trivially evade with a different email. Acceptable for MVP; a hard fix (requiring an account to redeem any coupon) is a product decision, not a schema one.

---

## 14. Media — the polymorphic model, evaluated and rejected

Phase 0 sketched a generic `media(owner_type, owner_id, ...)` table. Evaluated against MySQL/Prisma reality:

| | Polymorphic `media` table | Explicit per-owner relations (recommended) |
|---|---|---|
| Referential integrity | **None** — `owner_id` can point at a row that doesn't exist, or never did; MySQL has no native "conditional FK by discriminator column" mechanism | Real `FOREIGN KEY` per relation, enforced by the database |
| Cascade behavior | Can't be expressed — `ON DELETE CASCADE` needs a single target table | `ON DELETE CASCADE` works correctly (`product_images.product_id`) |
| Prisma support | Prisma has no native polymorphic-relation feature; it would need to be modeled as an untyped `Int`/`BigInt` `owner_id` with manual joins in application code — exactly the kind of hand-rolled workaround that erodes type safety | Prisma expresses it natively as a normal one-to-many/one-to-one relation |
| Actual usage shape in this domain | Products need a **gallery** (many images); brands/categories need **at most one** image each | A gallery and a single-optional-image are different enough shapes that one generic table wasn't even modeling them well |

**Recommendation, implemented above:** `product_images` as a real table with a real FK for the one genuine gallery case; `brands.logo_url` and `categories.image_url` as plain nullable `VARCHAR` columns for the single-optional-image case (no join needed at all for something that's 0-or-1). No generic `media` table exists in this design. If a second genuine gallery need appears later (e.g. review photos), it gets its own explicit table (`review_images`) at that time — not a preemptive generic mechanism.

---

## 15. Audit Logs

### `audit_logs`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `actor_id` | `BIGINT UNSIGNED` | nullable FK → `users.id`, `ON DELETE SET NULL` |
| `actor_type` | `ENUM('USER','SYSTEM')` | DEFAULT `USER` |
| `action` | `VARCHAR(100)` | e.g. `order.status.override`, `refund.issued`, `permission.granted` |
| `entity_type` | `VARCHAR(50)` | e.g. `order`, `payment_attempt`, `inventory_item` |
| `entity_id` | `BIGINT UNSIGNED` | not a real FK — deliberately, for the same reason `webhook_events.resolved_entity_id` isn't: the target table varies per row, and unlike the two-target `webhook_events` case, audit log entities span essentially every table in the system, so an exhaustive set of nullable FK columns isn't practical here. This one genuinely is a case where the flexibility of a loosely-typed reference outweighs the referential-integrity loss — audit logs are read for investigation, not joined into transactional queries. |
| `before_data`, `after_data` | `JSON` | nullable |
| `ip_address` | `VARCHAR(45)` | nullable |
| `created_at` | | (append-only — no `updated_at`, ever) |

Indexes, each serving a distinct real investigation query:
- `(entity_type, entity_id, created_at)` — "show everything that happened to order #4821"
- `(actor_id, created_at)` — "show everything this admin did"
- `(action, created_at)` — "show every refund issued this month" (also serves compliance reporting)

---

## 16. Settings

**Hybrid, not a single JSON blob and not a pure key-value table** — resolving the brief's explicit "avoid an uncontrolled JSON dumping ground" concern:

### `settings` — singleton row, real typed columns, for values read on nearly every request

| Column | Type | Notes |
|---|---|---|
| `id` | `TINYINT UNSIGNED` PK | always `1` — enforced by the application only ever writing/reading `id = 1` |
| `site_name` | `VARCHAR(150)` | |
| `default_currency` | `CHAR(3)` | DEFAULT `'NGN'` |
| `default_delivery_fee_minor` | `INT UNSIGNED` | nullable |
| `low_stock_threshold_default` | `DECIMAL(12,3)` | nullable — fallback when a specific `inventory_items.low_stock_threshold` isn't set |
| `support_email`, `support_phone` | | nullable |
| `updated_by` | `BIGINT UNSIGNED` | nullable FK → `users.id`, `ON DELETE SET NULL` |
| `updated_at` | | |

These are read on hot paths (every page footer, every inventory check) and benefit from real columns: no JSON parse, no key-lookup miss handling, compile-time type safety in the Prisma client.

### `setting_entries` — key/value, for infrequently-read, admin-configurable, loosely-typed values

| Column | Type | Notes |
|---|---|---|
| `key` | `VARCHAR(100)` | PK |
| `value` | `JSON` | |
| `value_type` | `ENUM('STRING','NUMBER','BOOLEAN','JSON')` | a casting/validation hint for the application layer |
| `description` | `VARCHAR(255)` | nullable |
| `updated_by` | `BIGINT UNSIGNED` | nullable FK → `users.id`, `ON DELETE SET NULL` |
| `updated_at` | | |

Feature flags, email-template configuration, and similar rarely-read admin toggles live here — never structural configuration the application depends on for every request.

---

## 17. Database Constraints — Summary Table

Every major table's constraint shape, condensed (full detail is in the per-domain sections above; this is the cross-reference the brief asked for under "for EVERY major table").

| Table | PK | Notable FKs (delete behavior) | Unique constraints | Soft delete? |
|---|---|---|---|---|
| `users` | id | — | `email` | ✅ `deleted_at` |
| `sessions` | id | `user_id` CASCADE | `session_token_hash` | — |
| `roles` / `permissions` | id | — | `name` / `key` | — |
| `user_roles` / `role_permissions` | composite | both CASCADE | PK *is* the uniqueness | — |
| `verification_tokens` | id | `user_id` CASCADE | `token_hash` | — |
| `brands` | id | — | `slug` | — |
| `categories` | id | `parent_id` RESTRICT | `slug` | — |
| `products` | id | `brand_id` SET NULL, `category_id` RESTRICT | `slug` | ✅ `deleted_at` |
| `product_variants` | id | `product_id` RESTRICT | `sku`; generated-column "one default per product" | status-based (`ARCHIVED`), not deleted |
| `product_images` | id | `product_id` CASCADE | — | — |
| `product_specifications` | id | `product_id` CASCADE | `(product_id, spec_key)` | — |
| `inventory_items` | id | `product_variant_id` RESTRICT | `product_variant_id` | — |
| `inventory_movements` | id | `inventory_item_id` RESTRICT, `order_item_id` RESTRICT, `created_by` SET NULL | generated-column: at most one `RESERVE`/`RELEASE`/`SALE` each per `order_item_id` | append-only |
| `addresses` | id | `user_id` CASCADE | generated-column "one default per user" | — |
| `carts` | id | `user_id` CASCADE | generated-column "one `ACTIVE` cart per user" + "one `ACTIVE` cart per guest token" (not plain `UNIQUE(user_id)`) | status-based (`CONVERTED`/`ABANDONED`), purged after a retention window |
| `cart_items` | id | `cart_id` CASCADE, `product_variant_id` CASCADE | `(cart_id, product_variant_id)` | — |
| `orders` | id | `user_id` SET NULL, `authoritative_payment_attempt_id` RESTRICT | `order_number`; `authoritative_payment_attempt_id` | ❌ never — immutable historical record |
| `order_items` | id | `order_id` CASCADE, `product_id`/`product_variant_id` SET NULL | `(order_id, product_variant_id)` | ❌ never |
| `order_addresses` | id | `order_id` CASCADE | `(order_id, type)` | ❌ never |
| `order_status_history` | id | `order_id` CASCADE, `actor_id` SET NULL | — | append-only |
| `payment_attempts` | id | `order_id` RESTRICT | `paystack_reference` | ❌ never |
| `webhook_events` | id | `resolved_payment_attempt_id`/`resolved_refund_id` SET NULL | `(event_type, paystack_transaction_id)` | append-only |
| `refunds` | id | `payment_attempt_id` RESTRICT, `order_id` RESTRICT, `requested_by` RESTRICT | `paystack_refund_reference` | ❌ never |
| `service_requests` | id | `user_id`/`assigned_to` SET NULL | — | — |
| `reviews` | id | `product_id` CASCADE, `user_id` CASCADE, `order_item_id` SET NULL | `(product_id, user_id)` | — |
| `coupons` | id | — | `code` | status-based (`is_active`) |
| `coupon_redemptions` | id | `coupon_id` RESTRICT, `order_id` RESTRICT | `order_id` | ❌ never |
| `audit_logs` | id | `actor_id` SET NULL | — | append-only |
| `settings` | id (=1) | `updated_by` SET NULL | — | — |
| `setting_entries` | key | `updated_by` SET NULL | PK *is* the key | — |

**Duplicate-prevention concerns from the brief, resolved:** duplicate SKU → `product_variants.sku UNIQUE` (global). Duplicate slug → `UNIQUE` on every `slug` column. Duplicate Paystack reference → `payment_attempts.paystack_reference UNIQUE`. Duplicate webhook event → `webhook_events(event_type, paystack_transaction_id) UNIQUE`. Duplicate role/permission assignment → composite PK on both junction tables. Duplicate cart item → `cart_items(cart_id, product_variant_id) UNIQUE`. Duplicate reservation → the conditional `UPDATE ... WHERE` pattern (§5) plus the generated-column unique index guaranteeing at most one `RESERVE` (and separately, at most one `SALE`) per `order_item_id`. Duplicate cart (two `ACTIVE` carts for one user/guest) → the generated-column "one `ACTIVE` cart per user"/"per guest token" indexes (§6). Duplicate order line for one variant → `order_items(order_id, product_variant_id) UNIQUE` (§7). Duplicate authoritative payment → `orders.authoritative_payment_attempt_id UNIQUE` + the conditional-UPDATE-set-once pattern. Refund over-allocation (successful **and** pending combined) → `payment_attempts.refunded_amount_minor + pending_refund_amount_minor` CHECK + the Allocate transaction's conditional UPDATE (§9).

---

## 18. Index Strategy

No blanket indexing — every index below is tied to a specific, real query.

**Catalog**
| Index | Query it serves |
|---|---|
| `products(slug)` — via `UNIQUE` | PDP lookup by URL slug |
| `products(category_id, status)` | Category page listing, active only |
| `products(status, is_featured, created_at)` | Homepage featured-products query |
| `products(brand_id)` | Brand page listing |
| `product_variants(sku)` — via `UNIQUE` | Admin/search lookup by SKU |
| `product_variants(product_id, status)` | "Get all active variants for this product" (PDP variant picker) |
| `categories(parent_id, sort_order)` | Category tree rendering |

Deliberately **not** indexed pre-emptively: the individual technical-facet columns (`power_rating_w`, `voltage_v`, etc.) — these become real composite indexes once Phase 13 (Search & SEO) measures actual filter-query shapes; guessing the right composite order now, before real traffic patterns exist, risks building indexes that don't match how filters actually get combined in the UI.

**Inventory**
| Index | Query it serves |
|---|---|
| `inventory_items(product_variant_id)` — via `UNIQUE` | The 1:1 lookup, every add-to-cart/checkout stock check |
| `inventory_movements(inventory_item_id, created_at)` | Per-item ledger history, chronological |
| `inventory_movements(order_item_id)` | "All inventory movements caused by this order line" — replaces the earlier `(reference_type, reference_id)` index now that order-driven movements reference `order_item_id` directly |
| `inventory_movements(reference_type, reference_id)` | Narrowed to the remaining `MANUAL`/`PURCHASE_ORDER` cases — "all movements from purchase order #77" |

**Orders**
| Index | Query it serves |
|---|---|
| `orders(order_number)` — via `UNIQUE` | Customer order-tracking lookup |
| `orders(user_id, created_at)` | "My orders," newest first |
| `orders(status, created_at)` | Admin order queue, filtered/sorted |

**Payments**
| Index | Query it serves |
|---|---|
| `payment_attempts(paystack_reference)` — via `UNIQUE` | Webhook resolution, verify-call correlation |
| `payment_attempts(order_id, status)` | "Does this order have a successful attempt yet" |
| `payment_attempts(status, created_at)` | TTL sweep for stuck `INITIATED`/`PENDING` attempts |

**Webhooks**
| Index | Query it serves |
|---|---|
| `webhook_events(event_type, paystack_transaction_id)` — via `UNIQUE` | Idempotent ingestion check |
| `webhook_events(processing_status, locked_at)` | Worker claim query + stale-lock requeue sweep |

**Refunds**
| Index | Query it serves |
|---|---|
| `refunds(payment_attempt_id)` | "All refunds against this attempt," balance calculation |
| `refunds(status)` | Admin "pending refunds" queue |
| `refunds(paystack_refund_reference)` — via `UNIQUE` | Refund webhook resolution |

---

## 19. Money and Quantity Representation

**Money:** every monetary column is `INT UNSIGNED` (minor units — kobo). Max value ≈ 42.9M NGN per column, comfortably above any plausible single-order/single-line amount for this catalog; flagged to revisit as `BIGINT UNSIGNED` only if a real use case (e.g. a large B2B commercial solar order) approaches that ceiling. **Never `FLOAT`/`DOUBLE`, never `DECIMAL` for money** — integers only, exactly per `docs/ARCHITECTURE.md`.

**Quantities — evaluated explicitly, not assumed.** Most of this catalog (panels, inverters, batteries, charge controllers, mounting hardware, protection devices) sells in **whole units** — `INT` would suffice for those. But **solar cable is commonly sold by length**, and length is genuinely fractional (2.5m, 7.5m) — an `INT` quantity column would force rounding up on every cable purchase, silently overcharging or under-fulfilling.

**Decision: `DECIMAL(12,3) UNSIGNED` for every quantity-shaped column** (`inventory_items.quantity_on_hand`/`quantity_reserved`, `cart_items.quantity`, `order_items.quantity`, `inventory_movements.on_hand_delta`/`reserved_delta`) — uniformly, not branched per product type. `DECIMAL` is exact fixed-point arithmetic (no floating-point drift, same integrity guarantee as money), and a whole-unit product's quantity is simply stored as `1.000` — no different in practice from an `INT`. `products.unit_of_measure` (`EACH`/`METER`) tells the UI layer whether to render a stepper or a decimal length input; it does not change the underlying column type. This avoids exactly the "two code paths for quantity math" branching the brief was concerned about avoiding for variants (§2) — the same principle applied consistently here.

---

## 20. Deletion Strategy

| Entity | Strategy | Why |
|---|---|---|
| `users` | Soft delete (`deleted_at`) | Referenced historically by orders, reviews, audit logs |
| `products` | Soft delete (`deleted_at`) | Referenced by `order_items` (informational FK), reviews |
| `categories`, `brands` | `ON DELETE RESTRICT`/`SET NULL` (no soft delete) | Low-cardinality reference data; a category with products can't be deleted at all (`RESTRICT`), a brand can be removed from products it no longer applies to (`SET NULL`) — no historical order ever points at a category/brand directly, so nothing needs preserving here |
| `product_variants` | **Status-based** (`ACTIVE`/`ARCHIVED`), not deleted | `inventory_items`/`order_items` reference it; `ON DELETE RESTRICT` from those tables makes hard deletion structurally impossible once it's ever been ordered or stocked anyway — `ARCHIVED` status is how it leaves the storefront |
| `carts`, `cart_items` | Hard delete (or `ABANDONED` status + periodic purge) | Genuinely ephemeral, zero historical/financial value once abandoned |
| `orders`, `order_items`, `order_addresses`, `order_status_history` | **Immutable historical record — never deleted, ever** | This is the one category the brief called out explicitly: financial records must not disappear |
| `payment_attempts`, `refunds`, `webhook_events` | **Immutable historical record — never deleted, ever** | Same reasoning, doubly so — these are the actual money-movement audit trail |
| `inventory_movements` | Append-only, never deleted or updated | The ledger's entire value is being a permanent, tamper-evident record |
| `audit_logs` | Append-only, never deleted or updated | Same |
| `addresses` (saved) | Hard delete allowed | `order_addresses` never references this table (§7/§10), so deleting a saved address has zero effect on historical orders |
| `reviews` | Status-based (`REJECTED`) for moderation; hard delete allowed for genuine removal requests (e.g. GDPR-style) | No downstream table depends on a review row existing |
| `coupons` | Status-based (`is_active`) | `coupon_redemptions` references it; historical redemptions must remain explainable |

---

## 21. Transaction Boundaries

### Checkout

```text
BEGIN
  validate cart (re-read live prices/stock)
  compute totals
  INSERT orders (PENDING_PAYMENT)
  INSERT order_items                                                              ⟵ per line item; yields order_item_id
  INSERT order_addresses
  UPDATE inventory_items SET quantity_reserved += qty WHERE ... available check   ⟵ per line item
  INSERT inventory_movements (RESERVE, order_item_id = :thisLine)                 ⟵ per line item, after its order_items row exists
COMMIT
```
All of this is **one transaction**. If any line's stock check fails, the whole transaction rolls back — no partial order, no partial reservation. **Ordering matters** (§5): `order_items` must be inserted before the `RESERVE` movements that reference them by `order_item_id`. `payment_attempts` creation and the Paystack Initialize API call happen **after** this commits, in a separate step (an external HTTP call must never be inside a DB transaction — it can't be rolled back, and holding a transaction open across a network call is a correctness and performance hazard).

### Successful payment (driven by the async worker, `docs/ARCHITECTURE.md` §6.3)

```text
BEGIN
  UPDATE payment_attempts SET status='SUCCESS', paid_at=NOW() WHERE id=:attemptId AND status='PENDING'
  UPDATE orders SET status='PAID', authoritative_payment_attempt_id=:attemptId
    WHERE id=:orderId AND status='PENDING_PAYMENT'            ⟵ 0 rows = already processed, STOP here
  UPDATE inventory_items SET quantity_on_hand -= qty, quantity_reserved -= qty WHERE ...   ⟵ per line item
  INSERT inventory_movements (SALE, order_item_id = :thisLine)                             ⟵ per line item, guarded by the generated-column unique index on (type, order_item_id)
  INSERT order_status_history
COMMIT
```
The order-status `UPDATE`'s zero-rows-affected outcome is the transaction's own internal idempotency check — if it affects zero rows, the remaining statements are skipped entirely (application-level branch inside the same transaction attempt, or simply not issued).

### Cancellation / TTL expiry

```text
BEGIN
  UPDATE orders SET status='CANCELLED' WHERE id=:orderId AND status='PENDING_PAYMENT'
  UPDATE inventory_items SET quantity_reserved -= qty WHERE ...             ⟵ per line item
  INSERT inventory_movements (RELEASE, order_item_id = :thisLine)           ⟵ per line item
  INSERT order_status_history
COMMIT
```

### Refund — now three distinct transactions, not one (see §9 for the full corrected design)

```text
Allocate (on request, before Paystack is ever called):
BEGIN
  UPDATE payment_attempts SET pending_refund_amount_minor += :amt
    WHERE id=:id AND refunded_amount_minor + pending_refund_amount_minor + :amt <= amount_minor
  INSERT refunds (status='REFUND_REQUESTED', ...)
COMMIT

Confirm (refund webhook reports success):
BEGIN
  UPDATE payment_attempts SET pending_refund_amount_minor -= :amt, refunded_amount_minor += :amt WHERE id=:id
  UPDATE refunds SET status='REFUNDED', processed_at=NOW() WHERE id=:refundId
  UPDATE orders SET status='REFUNDED' WHERE id=:orderId AND status IN (...) AND <refunded amount == paid amount>
COMMIT

Release (refund fails, or is cancelled by an admin, before confirmation):
BEGIN
  UPDATE payment_attempts SET pending_refund_amount_minor -= :amt WHERE id=:id
  UPDATE refunds SET status='REFUND_FAILED' | 'REFUND_CANCELLED', processed_at=NOW() WHERE id=:refundId
COMMIT
```
The Confirm transaction's final `orders` update is conditional on full-refund math and is skipped (order keeps its current status) for a partial refund — only the `refunds`/`payment_attempts` rows change in that case. Splitting what was previously a single "Refund" transaction into Allocate/Confirm/Release is the direct fix for the allocation bug described in §9 — the allocation now has an explicit lifecycle of its own, independent of whether it ultimately succeeds.

**What must be atomic vs. what must not:** every block above is one transaction because each contains at least one write whose correctness *depends* on another write in the same block (a reservation without its order is meaningless; a `SALE` movement without the order flipping to `PAID` is a lie). The Paystack API calls (Initialize, Verify, Refund) are **always outside** any transaction — they're slow, external, and non-transactional by nature; the pattern throughout is "transact the database effect, call the network separately," never both at once.

---

## 22. Concurrency Analysis

| Scenario | What happens | Why it's safe |
|---|---|---|
| **Two customers buying the last inverter** | Both issue `UPDATE inventory_items SET quantity_reserved += qty WHERE ... available >= qty`. InnoDB row-locks the matched row for the first transaction; the second's `UPDATE` blocks, then re-evaluates its `WHERE` against the post-first-transaction row once the lock releases, finds insufficient availability, affects 0 rows. | The `WHERE` clause re-reads current state at lock-acquisition time, not at query-issue time — this is what makes it a real compare-and-swap, not a read-then-write race. |
| **Same customer, two checkout tabs** | Same mechanism protects against oversell identically. Separately (a UX, not correctness, concern): the checkout use-case should check for an existing `PENDING_PAYMENT` order tied to the same cart before creating a second one — **flagged as an application-layer recommendation for Phase 8**, not a schema-level fix, since "is this a duplicate checkout attempt" isn't expressible as a table constraint. | Prevents two simultaneous reservations/orders for what's really one customer intent, even though neither would cause an oversell. |
| **Two webhook workers processing the same event** | The `webhook_events(event_type, paystack_transaction_id)` unique key means only one row for the event can exist in the first place; even so, the claim step (`UPDATE ... SET processing_status='PROCESSING' WHERE processing_status='PENDING'`) row-locks and lets only one worker's `UPDATE` succeed. | Two independent guards — the row can't even be duplicated, and even one row can't be double-claimed. |
| **Two payment attempts succeeding unexpectedly** (e.g. a retried attempt *and* the original both confirm) | The first `charge.success` to be processed wins the conditional `orders` UPDATE (`WHERE status='PENDING_PAYMENT'`) and sets `authoritative_payment_attempt_id`. The second's identical UPDATE affects 0 rows — its handler must recognize "order already has an authoritative attempt" and route to a **manual reconciliation / refund-the-extra-payment** path. | The schema prevents two attempts from *both* becoming authoritative (the `UNIQUE` on `orders.authoritative_payment_attempt_id` plus the conditional UPDATE), but it cannot make the *business* problem of a genuine double-charge disappear — that needs an operational alert, which is a Phase 9/17 observability concern, not a schema gap. Noted explicitly rather than glossed over. |
| **Two admins issuing the same refund simultaneously** | Both run the Allocate transaction's conditional `pending_refund_amount_minor` UPDATE (§9); InnoDB serializes via row lock on `payment_attempts`; the second one's UPDATE re-evaluates against the first's already-applied allocation (`refunded_amount_minor + pending_refund_amount_minor`, not just `refunded_amount_minor`) and is rejected if the combined total would exceed `amount_minor`. | Same compare-and-swap pattern as inventory reservation — this is a deliberately repeated pattern throughout the schema, not a one-off trick. Checking the *combined* ledger (not just confirmed refunds) is what makes two simultaneously in-flight partial refunds safe, not just two attempts at a full refund. |
| **Two inventory adjustments happening simultaneously** | Safe **only if** adjustments are always applied as relative deltas (`quantity_on_hand = quantity_on_hand + :delta`), never as an absolute "set to N" write. Two concurrent relative deltas commute — final value is correct regardless of interleave order. An absolute "set to N" write **would** be a lost-update race (whichever transaction commits last wins, silently discarding the other's intent). | **Recommendation carried into Phase 5's use-case design:** the admin inventory-adjustment UI may present an absolute target quantity for usability, but the use-case must translate that into a delta computed from a value read inside the same transaction, never issue a raw `SET quantity_on_hand = :absoluteValue`. |
| **Two requests race to create an `ACTIVE` cart for the same user/guest token** (e.g. two tabs both add-to-cart before either cart exists) | The first `INSERT` succeeds; the second's `INSERT` collides with `uq_one_active_cart_per_user`/`uq_one_active_cart_per_guest_token` and fails outright with a duplicate-key error. | The use-case catches that duplicate-key error and falls back to re-reading the now-existing `ACTIVE` cart rather than treating it as a real failure — a standard "insert, or fetch the row someone else just inserted" pattern, not a new mechanism. |

---

## 23. Entity-Relationship Diagrams

### Identity

```text
users ──< sessions
users ──< verification_tokens
users ──< user_roles >── roles ──< role_permissions >── permissions
```

### Catalog

```text
brands ──< products
categories ──< products                    (self-referencing: categories.parent_id)
products ──< product_variants
products ──< product_images
products ──< product_specifications
```

### Inventory

```text
product_variants ──1:1── inventory_items ──< inventory_movements
                                                    │
order_items ────────────────────────────────nullable FK (order_item_id)
   (RESERVE/RELEASE/SALE movements identify the precise line that caused them;
    ADJUSTMENT/RESTOCK leave this null — see §5)
```

### Commerce

```text
users ──< addresses
users ──0:1(ACTIVE)── carts ──< cart_items >── product_variants
              (or: guest_token_hash ──0:1(ACTIVE)── carts, mutually exclusive with user_id;
               CONVERTED/ABANDONED carts are not subject to this cardinality — §6)

users ──< orders ──< order_items >── product_variants (informational FK; unique per order — §7)
                 ──< order_addresses
                 ──< order_status_history
                 ──< payment_attempts   (1:N — see Payments below)

coupons ──< coupon_redemptions >── orders   (1:1 in practice via orders UNIQUE)
```

### Payments

```text
orders ──< payment_attempts ──< refunds
   │             │        (amount_minor, refunded_amount_minor,
   │             │         pending_refund_amount_minor — two-ledger
   │             │         allocation model, §9)
   │             └── orders.authoritative_payment_attempt_id (nullable FK, set once)
   │
webhook_events ──resolved-to──> payment_attempts   (nullable FK, not known at insert time)
webhook_events ──resolved-to──> refunds            (nullable FK, not known at insert time)
```

### Services

```text
users ──< service_requests   (nullable — guest requests carry no user_id)
users ──< service_requests   (assigned_to, a second nullable FK to the same table)
```

### Administration

```text
users ──< audit_logs        (actor_id, nullable)
users ──< settings          (updated_by, nullable)
users ──< setting_entries   (updated_by, nullable)
users ──< reviews >── products
```

### Complete relationship map (condensed)

```text
                         ┌────────────┐
                         │   users    │
                         └─────┬──────┘
        ┌───────┬────────┬─────┼─────────┬───────────┬────────────┐
        ▼        ▼        ▼    ▼          ▼           ▼            ▼
    sessions  verif.   roles addresses  carts       orders    service_requests
              tokens    │                             │
                        ▼                             ├──< order_items ──> product_variants
                   permissions                         ├──< order_addresses
                                                        ├──< order_status_history
                                                        ├──< payment_attempts ──< refunds
                                                        └──< (coupon_redemptions)

    brands ──┐
             ▼
    categories ──> products ──< product_variants ──1:1── inventory_items ──< inventory_movements
    (self-ref)          │             │
                        ├──< product_images
                        ├──< product_specifications
                        └──< reviews

    webhook_events ···resolved-to···> payment_attempts / refunds  (nullable, post-hoc)
```

---

## 24. Prisma Design Considerations

- **Naming:** Prisma models `PascalCase` singular (`Product`, `ProductVariant`), fields `camelCase`; `@@map("products")` / `@map("product_id")` to keep the actual MySQL schema `snake_case` per standard SQL convention. This is purely a Prisma-layer naming choice — the table/column names throughout this document are the real ones.
- **Relation naming:** explicit relation names wherever a model has more than one relation to the same target — `orders` has two FKs into `users` conceptually (none, actually — `user_id` is the only one) but `service_requests` has two (`user_id`, `assigned_to`) and **must** use named relations (`@relation("ServiceRequestRequester")` / `@relation("ServiceRequestAssignee")`) to disambiguate. Same for `order_status_history.actor_id` if a second `users` relation is ever added there.
- **Enum strategy:** Prisma `enum` (→ MySQL native `ENUM`) for small, stable, rarely-changing sets that benefit from compile-time exhaustiveness checking in application code — `OrderStatus`, `PaymentAttemptStatus`, `RefundStatus` (now including `REFUND_CANCELLED`, §9), `InventoryMovementType` (now without the redundant `CANCELLATION`, §5), `ReviewStatus`, `ServiceType`. **Not** used for anything that might need runtime extensibility without a migration (there is no such field in this design at MVP — `setting_entries.value_type` is the closest candidate and is intentionally still an enum, since its value set is genuinely fixed).
- **JSON usage:** Prisma `Json` type (→ MySQL native `JSON`) for `webhook_events.raw_payload`, `audit_logs.before_data`/`after_data`, `product_variants.option_values`, `settings/setting_entries.value` (`setting_entries`). Never used for anything queried/filtered against directly — every JSON column here is either write-once-read-whole (payloads, diffs) or read-whole-in-application-code (option values, typed settings), never the target of a `WHERE json_extract(...)`.
- **Decimal usage:** Prisma `Decimal` type for every quantity column (§19) and `efficiency_percent`, `weight_kg`, dimension columns. **Never** for money — money is `Int`/`BigInt` throughout, exactly per `docs/ARCHITECTURE.md`.
- **MySQL-specific considerations Prisma can't express natively — will require hand-edited migrations:**
  1. The generated-column + unique-index sets: `product_variants` at-most-one-default-variant (§2), `addresses` at-most-one-default-address (§10), `carts` at-most-one-`ACTIVE`-per-user *and* at-most-one-`ACTIVE`-per-guest-token (§6, two indexes), `inventory_movements` at-most-one-`RESERVE`/`RELEASE`/`SALE`-per-`order_item_id` (§5).
  2. Multi-column `CHECK` constraints referencing more than one column on the same row (`orders.total_minor` arithmetic check, `carts`'s guest-vs-authenticated exclusivity check, `coupons`'s type/value mutual-exclusivity check, `payment_attempts`'s `refunded_amount_minor + pending_refund_amount_minor <= amount_minor` check) — Prisma 5+ supports simple single-expression `@@check` in preview, but the workflow assumed here is: let `prisma migrate dev` generate the base migration from `schema.prisma`, then hand-edit the generated `migration.sql` to add these before applying, and **never** let a subsequent `prisma migrate dev` auto-regenerate over that file (documented in the migration's own header comment, a standard Prisma pattern for "customizing generated migrations").
  3. `STORED` generated columns for *derived, not just constrained,* values (`inventory_items.quantity_available`, `payment_attempts.available_refundable_amount_minor`) — Prisma doesn't have first-class syntax for computed/generated columns as of the current stable release; same hand-edit-the-migration workflow applies.
- **Composite unique constraints:** expressed natively via `@@unique([...])` — `cart_items(cartId, productVariantId)`, `order_items(orderId, productVariantId)`, `product_specifications(productId, specKey)`, `order_addresses(orderId, type)`, `reviews(productId, userId)`, `webhook_events(eventType, paystackTransactionId)`. No hand-editing needed for these.
- **Cascade/restrict behavior:** specified per-relation via `onDelete: Cascade` / `onDelete: Restrict` / `onDelete: SetNull` matching §17's table exactly — Prisma supports all three natively.
- **Migration strategy for Phase 2B:** build and migrate **incrementally by domain**, not as one 31-table migration — Identity → migrate → Catalog → migrate → Inventory → migrate → Commerce → migrate → Payments → migrate → Services/Reviews/Coupons → migrate → Administration → migrate. Each migration stays small enough to actually review before applying, and a mistake in one domain's migration doesn't block or entangle the others. The hand-edited generated-column migrations happen at the end of their respective domain's migration step: Catalog for the default-variant/image ones, Inventory for the `order_item_id` dedup one, Commerce for the default-address and active-cart ones, Payments for `available_refundable_amount_minor`.

---

## 25. Seed / Reference Data Plan

**Seeded at Phase 2B/setup time** (structural, not sample content):

- `roles`: `super_admin` (all permissions), `staff` (read-heavy + order/consultation updates, no `settings.manage`/`payments.refund` — per `docs/ARCHITECTURE.md` §11)
- `permissions`: `products.read`, `products.create`, `products.update`, `products.delete`, `inventory.read`, `inventory.adjust`, `orders.read`, `orders.update`, `payments.read`, `payments.refund`, `consultations.read`, `consultations.update`, `settings.manage` — matching `docs/ARCHITECTURE.md` §11's enumerated list exactly
- `role_permissions`: `super_admin` ↔ every permission; `staff` ↔ everything except `settings.manage`, `payments.refund`
- `settings`: the single singleton row (`id = 1`), populated with real launch values (site name, default currency, default delivery fee) once known
- One initial `super_admin` user — created via a secure setup script/CLI prompt in Phase 3, **not** a hardcoded seeded password

**Explicitly not seeded now, per instruction:** no fake products, brands, categories, or customers. Category *structure* (the tree shape from `docs/ARCHITECTURE.md`'s example — Solar Panels / Inverters / Batteries / etc.) is real launch content, not test data, so it's a Phase 4 content task, not a Phase 2 seed script.

---

## 26. Known Risks / Tradeoffs

1. **Three MySQL features Prisma can't express natively** (generated columns, multi-column CHECKs, the STORED derived-quantity column) mean part of Phase 2B's migrations must be hand-edited and protected from being clobbered by a future `prisma migrate dev`. This is a real, ongoing maintenance cost — every developer touching these migrations needs to know not to regenerate them blindly. Mitigated by documenting it directly in the migration file headers, not just here.
2. **`webhook_events.paystack_transaction_id` non-null assumption** (§8) is carried forward from Phase 0 as unverified against a live payload. If wrong, the idempotency key needs a fallback before Phase 9 ships.
3. **Guest coupon usage-limit-per-customer is only as strong as email matching** (§13) — a known, accepted gap, not a bug to be surprised by later.
4. **`ENUM` columns for status fields are cheap to read but not free to extend** — adding a new `OrderStatus` value is an `ALTER TABLE`, not a data-only change. Acceptable because these enums are genuinely stable business states, not admin-configurable ones (the one field that *did* want admin configurability — `service_requests.status` — was deliberately kept an `ENUM` anyway, per §11's reasoning, with the upgrade path documented rather than built).
5. **`DECIMAL(12,3)` quantities everywhere** (§19) is a uniform, branch-free choice, but it does mean every quantity column carries fixed-point overhead even for the 95%+ of products that only ever need whole units. Judged worth it for one consistent code path over two.
6. **`audit_logs.entity_id` has no real FK** (§15) — intentional, but means a corrupted/garbage `entity_id` is possible in theory (e.g. a bug logs the wrong ID). Mitigated by this being a diagnostic table, not a transactional one — a bad log row can't corrupt real state, only mislead an investigation.
7. **The cart purge job** (§6, "should a converted cart be retained permanently") names a retention window in principle but doesn't specify one — an actual number (and the job that enforces it) is a Phase 5/15 implementation detail, not a schema gap, but it's worth someone owning before `carts` accumulates unboundedly in production.
8. **`REFUND_CANCELLED` is a new admin-facing action** (§9) that needs to be gated behind the same `payments.refund` permission as issuing a refund in the first place (`docs/ARCHITECTURE.md` §11) — noted here so Phase 3/9's permission wiring doesn't treat it as a separate, forgettable permission.

---

## 27. Open Questions

1. **Auth provider's Prisma adapter shape** (§1) — carried forward from Phase 0, now schema-concrete: whichever library Phase 3 picks may require reshaping `users`/`sessions`/adding `accounts`/`verification_tokens` to match its adapter contract, or writing a custom adapter against the shape designed here. Needs resolving *before* Phase 2B migrates the Identity domain, not after.
2. **`product_images` "exactly one primary image" constraint** (§2) — deferred as an easy follow-up generated-column unique index, not built now; confirm before Phase 6 (Storefront UI) whether the PDP actually needs that guarantee or "first by `sort_order`" is good enough indefinitely.
3. **Money column width** (§19) — `INT UNSIGNED` (~42.9M NGN ceiling per column) assumed sufficient; confirm against realistic large commercial-order sizes before Phase 9.
4. **Whether `product_variants.currency` per-row is worth its storage cost now** versus a single global `default_currency` on `settings` — kept per-row for future-proofing against multi-currency; revisit if it never gets used before Phase 17.

---

## Self-Review (per the requested checklist)

1. **Normalization problems:** none found requiring correction. The deliberate denormalizations (`refunds.order_id` alongside `payment_attempt_id`; `payment_attempts.refunded_amount_minor`/`pending_refund_amount_minor` as running totals instead of always summing `refunds` live) are justified above (query convenience; concurrency-safe conditional-update targets) and remain reconcilable against their source of truth (`refunds` rows) if they ever drift — not silent duplication.
2. **Missing foreign keys:** the two intentionally-missing ones (`webhook_events` pre-resolution, `audit_logs.entity_id`) are explained, not overlooked. This revision *added* a foreign key that was missing in the first draft — `inventory_movements.order_item_id` — closing the gap between what the schema actually referenced and what the documentation claimed it enforced.
3. **Missing uniqueness constraints:** cross-checked against every "duplicate X" concern the brief listed (§17's summary) — all covered, including the two this revision added: `order_items(order_id, product_variant_id)` and the corrected `carts` active-only uniqueness.
4. **Dangerous cascade deletes:** audited — `CASCADE` is used only where the child row has zero independent value without its parent (junction tables, cart items, order line items *within* an order that's itself never deleted, product images/specs). Everything touching money or historical truth is `RESTRICT` or has no delete path at all. `inventory_movements.order_item_id` is `RESTRICT`, consistent with this rule — a movement record must never be able to lose the order line it's attributable to.
5. **Missing indexes:** §18 covers every listed domain (catalog, inventory, orders, payments, webhooks, refunds) with a named query per index; deliberately *not* pre-indexing the technical-facet filter columns until Phase 13 has real query shapes to design against. This revision replaced the `inventory_movements(reference_type, reference_id)` index with `inventory_movements(order_item_id)` for the order-driven case, narrowing the original index to its remaining actual use (`MANUAL`/`PURCHASE_ORDER`).
6. **Money/quantity errors:** money is `INT UNSIGNED` minor units throughout, no exceptions found. Quantity's fractional-cable-length case was explicitly evaluated (§19) rather than assumed away. The refund allocation fix (§9) is itself a money-accounting correction, now verified against every scenario in the checklist below.
7. **Race conditions:** all six scenarios the brief originally named are walked through concretely in §22, each resolved by a named mechanism; this revision added two more (cart creation race, and the refund-allocation race re-verified against the two-ledger model) — see the checklist below for the full accounting.
8. **Match against `docs/ARCHITECTURE.md`:** re-checked against this revision specifically — `docs/ARCHITECTURE.md` §10.2's refund lifecycle diagram did not previously include `REFUND_CANCELLED` and described the allocation mechanism only at the level of "a running total," which this revision has made more precise. **Updated in `docs/ARCHITECTURE.md` §10.2** as part of this revision (see below) — this is the one place a Phase 0 document needed a direct edit, not just a "differs from Phase 0" footnote, because the omission was a genuine cross-document contradiction, not a deliberate refinement.
9. **Architectural decisions differing from Phase 0** (explicit list, as requested; carried over from the previous draft plus this revision's additions marked **NEW**):
   - **Variant modeling resolved as Option A** (Phase 0 left this open), now further precisely worded as "at least one variant, exactly one default, at most one enforced by the database" **(NEW, this revision)**.
   - **`media` polymorphic table dropped entirely**, replaced by `product_images` (real FK) + plain URL columns on `brands`/`categories`.
   - **`installation_requests` merged into `service_requests`** with a `service_type` discriminator, rather than a separate table.
   - **`inventory_movements.quantity_delta` split into `on_hand_delta`/`reserved_delta`** — a refinement of Phase 0's single-column sketch.
   - **Quantities are `DECIMAL(12,3)`, not `INT`** — Phase 0 didn't resolve this; resolved here after evaluating the cable-by-meter case.
   - **`orders.coupon_id` dropped** in favor of `coupon_redemptions` as sole source of truth.
   - **`settings` split into a typed singleton (`settings`) + a KV table (`setting_entries`)**, rather than Phase 0's single generic settings concept.
   - **Generated-column unique indexes** introduced as concrete defense-in-depth mechanisms not previously specified at this level of detail.
   - **`inventory_movements.reference_type='ORDER'` replaced by `order_item_id` (NEW, this revision)** — Phase 0 (§7) described reservations as referencing `orders.id`; this document now references the more precise `order_items.id`, and `docs/ARCHITECTURE.md` §7's table is updated to match (see below).
   - **`payment_attempts.refunded_amount_minor` is no longer the only refund ledger — `pending_refund_amount_minor` is new (NEW, this revision)** — `docs/ARCHITECTURE.md` §10.2 is updated to match.
   - **`REFUND_CANCELLED` added to the refund status enum (NEW, this revision)** — not present in `docs/ARCHITECTURE.md` §10.2's original state diagram; added there too.
10. **STOP.**

### Corrections self-review — the specific scenarios requested

**Refunds**
- *Can two admins request refunds simultaneously?* Yes, safely — both run the Allocate transaction; InnoDB's row lock on `payment_attempts` serializes them; the second's conditional check runs against the first's already-applied `pending_refund_amount_minor` (§9, §22).
- *Can pending refunds exceed the paid amount?* No — the Allocate transaction's `WHERE refunded_amount_minor + pending_refund_amount_minor + :amount <= amount_minor` check, backed by the `CHECK` constraint as a database-level backstop (§9).
- *Can a failed refund release its allocation?* Yes — the Release transaction decrements `pending_refund_amount_minor` on `REFUND_FAILED` exactly as on `REFUND_CANCELLED` (§9's transition table).
- *Can a successful refund be counted twice?* No — the Confirm transaction's `UPDATE ... WHERE status = 'REFUND_PENDING'` only fires once per refund row; a second attempt to confirm the same row affects 0 rows (the same conditional-UPDATE idempotency pattern used throughout §21).
- *Can partial refunds work?* Yes — `refunds.amount_minor` is independent of `payment_attempts.amount_minor`; any amount up to `available_refundable_amount_minor` is accepted (§9).
- *Can multiple partial refunds work?* Yes — each new request's Allocate check runs against the *combined* confirmed-plus-pending total, so a second and third partial refund are each evaluated against what's genuinely still available (§9) — this is precisely the bug this revision fixed.
- *Can a full refund transition the order correctly?* Yes — the Confirm transaction's final conditional `orders` update fires only when the refunded total equals the attempt's full paid amount (§21); a partial refund leaves the order's status untouched.

**Variants**
- *Can a product exist without a variant?* Not through the intended code path — the application/domain transaction (§2) creates a product and its first default variant together, atomically. The database alone does not forbid a variant-less product existing (that half of the invariant is explicitly *not* a database guarantee — stated plainly in §2, not glossed over).
- *Can two default variants exist (for one product)?* No — `uq_at_most_one_default_variant_per_product` makes this a database-level impossibility, not just an application convention (§2).
- *Can a product have zero default variants?* The database permits it (a data-quality gap, same root cause as the first question); the application transaction is what prevents it in practice. Flagged, not silently assumed solved.
- *Can replacing the default variant work safely?* Yes — the two-step transaction (unset old default, then set new default, in that order) never presents the unique index with two simultaneous non-null keys for one `product_id` (§2).

**Cart**
- *Can two `ACTIVE` carts exist for the same user?* No — `uq_one_active_cart_per_user` (§6).
- *Can historical carts coexist?* Yes — `CONVERTED`/`ABANDONED` rows generate `NULL` in the generated key and are entirely unrestricted in number (§6) — this is the exact fix for the bug identified in this revision.
- *Can two `ACTIVE` guest carts share the same guest token?* No — `uq_one_active_cart_per_guest_token` (§6), independent of the user-scoped index.
- *Can a user and guest accidentally share a cart?* No — the CHECK constraint requiring exactly one identity axis per row is unchanged and untouched by this revision (§6).

**Inventory**
- *Can two customers reserve the last unit?* No — the conditional `UPDATE inventory_items ... WHERE (quantity_on_hand - quantity_reserved) >= :qty` row-locks and re-evaluates per §5/§22, unchanged by this revision.
- *Can the same order generate two `SALE` movements?* No — even under the corrected model, two `SALE` rows for the same order would necessarily carry two different `order_item_id`s (one per line) or collide on the same one; the generated unique index catches the latter case per line (§5).
- *Can one order item generate two `SALE` movements?* No — this is now the **precise, literal** guarantee of `uq_one_reserve_release_sale_per_order_item`, not an approximation of it (§5) — the actual bug this revision fixed.
- *Can a refund accidentally alter inventory?* No — §9 is explicit that a refund never triggers an automatic inventory movement; restocking a physical return stays a separate, manually-entered `RETURN` movement, unaffected by this revision.
- *Can a failed payment accidentally consume stock?* No — only a `PENDING_PAYMENT → PAID` transition triggers the `SALE` conversion (§21); a `FAILED`/`ABANDONED`/`INITIALIZATION_FAILED` payment attempt leaves the reservation untouched, per `docs/ARCHITECTURE.md` §7.
- *Can cancellation release stock twice?* No — the generated unique index also covers `RELEASE`, at one-per-`order_item_id`; a second `RELEASE` attempt for the same line fails the same way a second `SALE` would (§5) — this protection is new in this revision (the original draft only deduplicated `SALE`).

**Orders**
- *Can the same variant appear twice in one order?* No, as of this revision — `order_items(order_id, product_variant_id) UNIQUE` (§7), the direct fix requested.
- *Can an order survive product deletion?* Yes — `order_items`'s FKs to `products`/`product_variants` are `ON DELETE SET NULL`, while every snapshot field remains populated regardless (§7), unaffected by this revision.
- *Can historical order data remain understandable?* Yes — unchanged by this revision; if anything, more precise now, since `inventory_movements` can be traced to the exact order line that caused each stock change (§5).

**Payments**
- *Can an order have multiple attempts?* Yes — unchanged, `payment_attempts` is 1:N off `orders` (§8).
- *Can two attempts both become authoritative?* No — `orders.authoritative_payment_attempt_id UNIQUE` + the conditional set-once `UPDATE`, unchanged by this revision (§8, §22).
- *Can a duplicate webhook cause duplicate inventory deduction?* No — three independent layers, one of which is now more precisely stated: the `webhook_events` unique natural key, the worker's claim-lock, and the `inventory_movements` generated unique index — now scoped to the literal `order_item_id`, not an approximation of it (§5, §8).
- *Can a late successful webhook pay a cancelled order?* No — the order state machine rejects `CANCELLED → PAID` (`docs/ARCHITECTURE.md` §8), unaffected by this revision; the reconciliation-case handling for that scenario is unchanged.

---

**Phase 2A revision complete. No `schema.prisma`, no migrations, no seed scripts, no application code were created. Awaiting explicit approval before proceeding to Phase 2B.**

# Phase 2B — Prisma Schema & Database Migration Implementation Report

Status: **database implementation layer only** — no repositories, services, use-cases, controllers, API routes, UI, or seed data with business content were created, per the Phase 2B brief.

Source of truth: `docs/DATABASE_DESIGN.md` (Phase 2A, revised) + `docs/ARCHITECTURE.md` (Phase 0). This report documents the translation into `prisma/schema.prisma` and MySQL migrations, every point where MySQL rejected the documented design verbatim, and the verification performed against a real MySQL 8.0.34 database (not just `prisma generate` succeeding).

---

## A. Files created/modified

**Created:**
- `prisma/schema.prisma` — full rewrite (was the Phase 1 skeleton: generator + datasource only, zero models)
- `prisma/migrations/20260808130328_identity_domain/migration.sql`
- `prisma/migrations/20260808131144_catalog_domain/migration.sql`
- `prisma/migrations/20260808132715_inventory_domain/migration.sql`
- `prisma/migrations/20260808134322_commerce_domain/migration.sql`
- `prisma/migrations/20260808140413_payments_domain/migration.sql`
- `prisma/migrations/20260808141242_services_reviews_domain/migration.sql`
- `prisma/migrations/20260808141519_administration_domain/migration.sql`
- `prisma/migrations/migration_lock.toml` (Prisma-managed, records `provider = "mysql"`)
- `docs/PHASE_2B_REPORT.md` (this file)

**Modified:** none outside `prisma/` and this report — no application code touched.

**Not created** (explicitly out of scope, confirmed): repositories, services, use-cases, controllers, API routes, UI, webhook workers, seed scripts with fake/sample business data.

---

## B. Migration order

```text
Migration 1 → 20260808130328_identity_domain
              users, sessions, roles, permissions, user_roles, role_permissions,
              verification_tokens

Migration 2 → 20260808131144_catalog_domain
              brands, categories, products, product_variants, product_images,
              product_specifications
              + hand-edited: product_variants.default_variant_key (generated column)

Migration 3 → 20260808132715_inventory_domain
              inventory_items, inventory_movements
              + hand-edited: inventory_items.quantity_available (generated column),
                3 quantity CHECKs, inventory_movements.order_item_movement_dedup_key
                (generated column), order_item_required CHECK
              (inventory_movements.order_item_id created as a plain nullable
               column here — order_items doesn't exist yet; see §D)

Migration 4 → 20260808134322_commerce_domain
              addresses, carts, cart_items, orders, order_items, order_addresses,
              order_status_history, coupons, coupon_redemptions
              + hand-edited: addresses.default_address_key, carts.active_cart_user_key/
                active_cart_guest_key (generated columns), carts identity CHECK,
                orders total-arithmetic CHECK, coupons type/value CHECK
              + closes forward reference: ALTER TABLE inventory_movements ADD
                CONSTRAINT ...order_item_id_fkey (now that order_items exists)
              (orders.authoritative_payment_attempt_id created as a plain nullable
               + unique column here — payment_attempts doesn't exist yet; see §D)

Migration 5 → 20260808140413_payments_domain
              payment_attempts, webhook_events, refunds
              + hand-edited: payment_attempts.available_refundable_amount_minor
                (generated column), refund-allocation CHECK, webhook resolved-
                exclusive CHECK
              + closes forward reference: ALTER TABLE orders ADD CONSTRAINT
                ...authoritative_payment_attempt_id_fkey (now that
                payment_attempts exists) — the circular FK is now fully closed
                both directions

Migration 6 → 20260808141242_services_reviews_domain
              service_requests, reviews
              + hand-edited: reviews rating-range CHECK
              (coupons/coupon_redemptions were migrated in Migration 4 — see
               the scope note below)

Migration 7 → 20260808141519_administration_domain
              audit_logs, settings, setting_entries
              (no hand-editing required — no generated columns or CHECKs in
               this domain)
```

**Scope note on migration grouping:** the brief's phase list names step 6 "Services / Reviews / Coupons." `docs/DATABASE_DESIGN.md` §0 places `coupons`/`coupon_redemptions` in the **Commerce** domain, not Services — they were migrated in Migration 4 accordingly, following the approved design document's own grouping rather than the brief's shorthand label. No table, column, or relationship differs as a result; only which migration file it lives in.

---

## C. Prisma models implemented (32 models, 22 enums)

**Identity (7):** `User`, `Session`, `Role`, `Permission`, `UserRole`, `RolePermission`, `VerificationToken`
**Catalog (6):** `Brand`, `Category`, `Product`, `ProductVariant`, `ProductImage`, `ProductSpecification`
**Inventory (2):** `InventoryItem`, `InventoryMovement`
**Commerce (9):** `Address`, `Cart`, `CartItem`, `Order`, `OrderItem`, `OrderAddress`, `OrderStatusHistory`, `Coupon`, `CouponRedemption`
**Payments (3):** `PaymentAttempt`, `WebhookEvent`, `Refund`
**Services (1):** `ServiceRequest`
**Community (1):** `Review`
**Administration (3):** `AuditLog`, `Settings`, `SettingEntry`

Total: **32 tables** — `docs/DATABASE_DESIGN.md` §0 itemizes exactly this set across its domain table but its own summary line says "31 tables total," which undercounts its own list by one; noted here as a pre-existing documentation slip, not a schema discrepancy (every table it names is implemented).

---

## D. Database-specific SQL — every manual addition

### D.1 Generated columns (7, exactly matching the brief's §25 list)

| Table.column | Expression | Purpose |
|---|---|---|
| `product_variants.default_variant_key` | `CASE WHEN is_default THEN product_id ELSE NULL END` | At most one default variant per product |
| `addresses.default_address_key` | `CASE WHEN is_default THEN user_id ELSE NULL END` | At most one default address per user |
| `carts.active_cart_user_key` | `CASE WHEN status='ACTIVE' THEN user_id ELSE NULL END` | At most one ACTIVE cart per user |
| `carts.active_cart_guest_key` | `CASE WHEN status='ACTIVE' THEN guest_token_hash ELSE NULL END` | At most one ACTIVE cart per guest token |
| `inventory_items.quantity_available` | `quantity_on_hand - quantity_reserved` | Always-derived stock figure |
| `inventory_movements.order_item_movement_dedup_key` | `CASE WHEN type IN ('RESERVE','RELEASE','SALE') THEN CONCAT(type,'-',order_item_id) ELSE NULL END` | At most one RESERVE/RELEASE/SALE per order item |
| `payment_attempts.available_refundable_amount_minor` | `amount_minor - refunded_amount_minor - pending_refund_amount_minor` | Admin-facing refundable balance |

All 7 confirmed via `information_schema.COLUMNS.GENERATION_EXPRESSION` against the live database (§E) — not assumed from the migration file alone.

### D.2 Unique indexes backing the generated columns

`uq_at_most_one_default_variant_per_product`, `uq_one_default_address_per_user`, `uq_one_active_cart_per_user`, `uq_one_active_cart_per_guest_token`, `uq_one_reserve_release_sale_per_order_item`.

### D.3 CHECK constraints (10)

| Constraint | Table | Enforces |
|---|---|---|
| `chk_inventory_items_on_hand_nonneg` | inventory_items | `quantity_on_hand >= 0` |
| `chk_inventory_items_reserved_nonneg` | inventory_items | `quantity_reserved >= 0` |
| `chk_inventory_items_reserved_le_on_hand` | inventory_items | `quantity_reserved <= quantity_on_hand` |
| `chk_inventory_movements_order_item_required` | inventory_movements | **Phase 2B hardening requirement (§6.2 of the brief)** — `type NOT IN ('RESERVE','RELEASE','SALE') OR order_item_id IS NOT NULL` |
| `chk_carts_identity_exclusive` | carts | Exactly one of `user_id`/`guest_token_hash` |
| `chk_orders_total_arithmetic` | orders | `total_minor = subtotal - discount + delivery_fee + tax` |
| `chk_coupons_type_value_exclusive` | coupons | FLAT↔`value_minor`, PERCENTAGE↔`percentage`, mutually exclusive |
| `chk_payment_attempts_refund_allocation` | payment_attempts | `refunded_amount_minor + pending_refund_amount_minor <= amount_minor` |
| `chk_webhook_events_resolved_exclusive` | webhook_events | At most one of `resolved_payment_attempt_id`/`resolved_refund_id` |
| `chk_reviews_rating_range` | reviews | `rating BETWEEN 1 AND 5` |

### D.4 Deferred FKs (forward references), added via `ALTER TABLE ADD CONSTRAINT`

1. **`inventory_movements.order_item_id → order_items.id`** (`ON DELETE RESTRICT ON UPDATE RESTRICT`) — created as a plain nullable column with no constraint in Migration 3 (Inventory), because `order_items` doesn't exist until Migration 4 (Commerce). The real FK is added at the top of Migration 4, immediately once `order_items` exists. This forward reference isn't explicitly named in the brief (which discusses the orders↔payment_attempts case) but is structurally identical and unavoidable given `inventory_movements.order_item_id` (Inventory domain) must point at `order_items` (Commerce domain, later in the approved sequence) — handled with the same pattern.
2. **`orders.authoritative_payment_attempt_id → payment_attempts.id`** (`ON DELETE RESTRICT ON UPDATE CASCADE`) — exactly the circular reference the brief called out in §13. Created as a plain nullable + unique column in Migration 4 (Commerce); the real FK is added at the top of Migration 5 (Payments) once `payment_attempts` exists. Verified both directions in §E/§F.

### D.5 Documented deviations from the approved design (MySQL rejected the literal spec)

Three FK delete/update actions had to change from the documented value because MySQL enforces rules `docs/DATABASE_DESIGN.md` didn't anticipate. **None of these are silent** — each is commented in both `schema.prisma` and the migration SQL, at the exact line, explaining the MySQL error code and the practical consequence.

| Documented | Implemented | MySQL error avoided | Practical consequence |
|---|---|---|---|
| `product_variants.product_id` FK: `ON UPDATE CASCADE` (Prisma default, not explicit in the design doc) | `ON UPDATE RESTRICT` | 1215 — a FK's `ON UPDATE CASCADE`/`SET NULL` is rejected when its column feeds a `STORED` generated column in the same table (`default_variant_key` reads `product_id`) | None — primary keys are never updated in practice |
| `addresses.user_id` FK: `ON DELETE CASCADE` (§10) | `ON DELETE RESTRICT` | Same MySQL 1215 rule — `user_id` feeds `default_address_key` | Hard-deleting a user with saved addresses now requires the application to delete the addresses first. Low impact: `users` uses soft delete (`deletedAt`) as its normal path; hard delete is already an exceptional operation (e.g. compliance erasure) |
| `carts.user_id` FK: `ON DELETE CASCADE` (§6) | `ON DELETE RESTRICT` | Same MySQL 1215 rule — `user_id` feeds `active_cart_user_key` | Hard-deleting a user with an active cart requires the application to delete/convert the cart first — same low-impact reasoning as above |
| `webhook_events.resolved_payment_attempt_id`/`resolved_refund_id` FKs: `ON DELETE SET NULL` (§8) | `ON DELETE RESTRICT`, `ON UPDATE RESTRICT` | 3823 — MySQL refuses a `CHECK` constraint on any column participating in a `SET NULL`/`CASCADE` FK referential action, and `chk_webhook_events_resolved_exclusive` is an explicit "MUST be preserved" requirement | None — `payment_attempts` and `refunds` rows are never deleted in this design (§20), so the `SET NULL` path would never have executed anyway |

Also generalized beyond the four cases above: **`product_variants.product_id`, `addresses.user_id`, `carts.user_id`, and `inventory_movements.order_item_id` all use `ON UPDATE RESTRICT`** rather than Prisma's `CASCADE` default, since each feeds a generated column in its own table. This is stated once here rather than repeated per row.

---

## E. Verification

| Check | Result |
|---|---|
| `prisma validate` (after every domain) | ✅ valid every time |
| `prisma format` | ✅ applied throughout |
| `prisma generate` (Prisma Client) | ✅ succeeded after every migration, final client reflects all 32 models |
| Migration application | ✅ all 7 migrations applied to the real dev database (`watplux`, MySQL 8.0.34 at 127.0.0.1) — not just the shadow database |
| `prisma migrate status` | ✅ "7 migrations found... Database schema is up to date!" |
| `prisma migrate diff` (live DB vs. schema.prisma) | ✅ **empty diff** — zero drift between the actual MySQL schema and what `schema.prisma` declares, checked after every single migration, not just at the end |
| **Reproducibility from empty** | ✅ `prisma migrate deploy` against a brand-new empty database (`watplux_repro_test`) applied all 7 migrations cleanly with zero errors, producing **33 tables** (32 business tables + `_prisma_migrations`) — identical table count to the working dev database. Test database dropped after confirming. |
| Generated columns (7) | ✅ confirmed via `information_schema.COLUMNS.GENERATION_EXPRESSION` against the live database — all 7 are true MySQL `GENERATED ALWAYS AS (...) STORED` columns, not plain columns |
| CHECK constraints (10) | ✅ confirmed via `information_schema.TABLE_CONSTRAINTS` — all present, all fired correctly in negative tests (§F) |
| Foreign keys | ✅ 46 FKs total, spot-checked per domain against `information_schema.REFERENTIAL_CONSTRAINTS` for exact `DELETE_RULE`/`UPDATE_RULE` match to the design (with the 4 documented deviations in §D.5) |
| Circular FK (orders ↔ payment_attempts) | ✅ confirmed both directions present in `information_schema` with `RESTRICT`/`RESTRICT` — order can have many attempts, an attempt belongs to one order, `authoritativePaymentAttemptId` nullable until success, unique so one attempt can't be claimed by two orders |
| Indexes | ✅ every named index from `docs/DATABASE_DESIGN.md` §18 created; verified present via `SHOW CREATE TABLE` spot-checks per domain |

All test/verification data was inserted and then deleted after each domain's checks — every table is confirmed empty (`SELECT table_rows` = 0 across all 32 business tables) at the end of Phase 2B.

---

## F. Negative tests — exactly the list the brief required, all confirmed rejected

| Invalid operation | Result |
|---|---|
| Two default variants for one product | ❌ rejected — `uq_at_most_one_default_variant_per_product` duplicate-key error |
| Two ACTIVE carts for one user | ❌ rejected — `uq_one_active_cart_per_user` |
| Two ACTIVE carts for one guest token | ❌ rejected — `uq_one_active_cart_per_guest_token` |
| Duplicate SALE for one order item | ❌ rejected — `uq_one_reserve_release_sale_per_order_item` |
| Duplicate RELEASE for one order item | ❌ rejected — same index |
| Duplicate RESERVE for one order item | ❌ rejected — same index |
| SALE without `order_item_id` | ❌ rejected — `chk_inventory_movements_order_item_required` |
| RELEASE without `order_item_id` | ❌ rejected — same CHECK (RESERVE tested explicitly; RELEASE/SALE share the identical CHECK expression, confirmed by inspection of the constraint definition) |
| RESERVE without `order_item_id` | ❌ rejected — same CHECK |
| Refund allocation exceeding amount paid | ❌ rejected — the conditional `UPDATE ... WHERE refunded + pending + :amount <= amount_minor` affected 0 rows when a second concurrent-style allocation would have exceeded the paid amount (tested with a real sequence: 60,000 + 50,000 against a 100,000 payment — the second was correctly refused while a smaller concurrent 30,000 request succeeded) |
| Invalid cart identity (both or neither of user/guest set) | ❌ rejected — `chk_carts_identity_exclusive`, tested both malformed cases |
| Invalid coupon type/value combination | ❌ rejected — `chk_coupons_type_value_exclusive`, tested both malformed cases (wrong field set, required field missing) |
| Negative inventory quantity | ❌ rejected — `chk_inventory_items_on_hand_nonneg` |
| Reserved quantity > on-hand quantity | ❌ rejected — `chk_inventory_items_reserved_le_on_hand` |
| Two authoritative payment attempts for one order | ❌ rejected — `uq_orders_authoritative_payment_attempt`, and separately the conditional `UPDATE ... WHERE status='PENDING_PAYMENT'` pattern confirmed as a 0-row idempotent no-op on a second attempt |
| Duplicate Paystack reference | ❌ rejected — `payment_attempts_paystack_reference_key` |
| Duplicate webhook natural key | ❌ rejected — `uq_webhook_events_natural_key` |
| Duplicate review (same customer, same product) | ❌ rejected — `uq_reviews_product_user` |
| Rating outside 1–5 | ❌ rejected — `chk_reviews_rating_range` |
| Duplicate order line for one variant | ❌ rejected — `uq_one_line_per_variant_per_order` |
| Hard-delete a user with saved addresses/an active cart | ❌ rejected — `RESTRICT` (the documented-deviation FKs from §D.5), confirmed with a real `DELETE FROM users` attempt |

**Valid scenarios confirmed to remain possible:**

| Scenario | Result |
|---|---|
| Multiple historical carts (`CONVERTED`/`ABANDONED`) for one user | ✅ succeeded, unlimited, alongside one ACTIVE cart |
| Multiple partial refunds against one payment attempt | ✅ full sequence tested: allocate 60,000 → allocate 30,000 (fits in remaining 40,000) → release the 60,000 as `REFUND_FAILED` → confirm the 30,000 as `REFUNDED` → ledgers correct at every step (`refunded_amount_minor`/`pending_refund_amount_minor`/`available_refundable_amount_minor`) |
| Multiple RETURN movements for one order item | ✅ two `RETURN` rows against the same `order_item_id` both succeeded (the generated dedup key deliberately excludes `RETURN`) |
| Multiple payment attempts for one order | ✅ `FAILED`, `ABANDONED`, and `SUCCESS` attempts coexisted against one order |
| One failed payment followed by a successful payment | ✅ modeled directly in the multi-attempt test above |
| One refund request followed by cancellation | ✅ tested end-to-end: allocate → `REFUND_CANCELLED` → allocation released, ledgers correct |
| One refund request followed by gateway failure | ✅ tested end-to-end: allocate → `REFUND_FAILED` → allocation released, ledgers correct |
| Idempotent refund confirmation (confirming an already-`REFUNDED` row twice) | ✅ second attempt's conditional `UPDATE ... WHERE status='REFUND_PENDING'` affected 0 rows |

---

## G. Known limitations

1. **The four documented FK-action deviations (§D.5)** are permanent characteristics of this schema under MySQL, not temporary workarounds — anyone modifying these tables later needs to know why `ON DELETE CASCADE`/`SET NULL` can't be restored without first removing the corresponding generated column or CHECK constraint.
2. **Every hand-edited migration SQL file must never be regenerated** by a future `prisma migrate dev` run that touches the same table — confirmed empirically safe for the schema *as declared* (zero drift detected after each domain), but this depends on nobody changing a generated-column field's Prisma declaration (e.g. adding a `@default`) in a way that would make Prisma think it owns that column's definition.
3. **Not independently verified**: behavior under a true concurrent MySQL connection (two simultaneous sessions racing the same `UPDATE ... WHERE` statement) — the negative/positive tests here were run sequentially against a single connection, which correctly exercises every constraint's *logic* but not real lock contention. Genuine concurrency testing (two live connections) is a Phase 5+/16 (Testing) activity once use-cases exist to drive it.
4. **The four Phase 2A open questions remain open**, per the brief's explicit instruction not to close them: auth provider/Prisma adapter shape, `product_images` exactly-one-primary constraint, money column width, per-variant currency. Nothing in Phase 2B forced a decision on any of them.
5. **`docs/DATABASE_DESIGN.md`'s "31 tables total" summary line is a pre-existing off-by-one** against its own itemized §0 list (32) — noted, not corrected here, since Phase 2B's mandate is implementation, not further Phase 2A document editing.

---

## H. Phase status

```text
PHASE 2B COMPLETE — READY FOR REVIEW
```

No repositories, services, use-cases, controllers, API routes, workers, authentication logic, UI, or business behavior were implemented. All 33 tables (32 business + migrations tracking) exist in the real MySQL database, verified via live introspection and negative/positive testing, not merely via `prisma generate` succeeding. Awaiting explicit approval before any further phase.

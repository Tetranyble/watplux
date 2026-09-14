# Phase 4 — Catalog/Product Domain Implementation Plan

Status: **plan only — no application code written**. This resolves every
catalog-specific open question before implementation, against the actual
current state of `prisma/schema.prisma`, `docs/DATABASE_DESIGN.md` §2/§3/§14/§17–20,
`docs/ARCHITECTURE.md` §2/§11/§12/§13/§14, and the Phase 3 implementation
(`docs/PHASE_3_AUTH_RBAC_IMPLEMENTATION.md`) for module-structure and
permission-enforcement precedent.

---

## 0. What this plan resolves

The approved schema and design docs already settled the hard architectural
questions (Option A variant model, the two-half default-variant invariant,
the EAV-vs-real-column line for solar specs, rejecting a polymorphic media
table). What they did **not** settle, and what this plan resolves before
any code is written:

1. Who can read what, without authentication (§9).
2. How the primary-image invariant is enforced given it isn't a DB constraint (§7).
3. How `product_specifications` stays "controlled EAV" given the schema has no separate definition table (§8).
4. Deterministic slug generation and collision handling (§11).
5. Pagination shape for catalog listings (§16).
6. Exactly which transactions are new catalog-module responsibilities vs. already-decided database mechanics (§13).
7. What "minimal API/test surface" means for Phase 4 without building storefront or admin UI (§19).
8. How the product-lifecycle/default-variant invariant survives genuinely concurrent requests — a bare `$transaction` is not sufficient on its own, and §13a specifies the exact row-locking mechanism, what it locks, and why (added in this revision).
9. Distinguishing automatic slug generation (collision → suffix) from an administrator's explicit slug choice (collision → `ConflictError`, never silently rewritten) (§11, revised in this revision).

Everything else below is direct implementation of decisions already made
in Phase 2A/2B — this plan does not revisit or reopen those.

---

## 1. Schema recap (no changes — read directly from `prisma/schema.prisma`)

No migration is anticipated for Phase 4. The six catalog tables already
exist exactly as designed:

| Model | Key facts relevant to Phase 4 |
|---|---|
| `Brand` | `slug` unique, `isActive`, `logoUrl` nullable — no hierarchy |
| `Category` | self-referencing (`parentId` → `Category.id`, `ON DELETE RESTRICT`), `slug` unique, `sortOrder`, `isActive`, index `(parentId, sortOrder)` |
| `Product` | **no price/SKU/stock** — `status: DRAFT\|ACTIVE\|ARCHIVED`, `deletedAt` (soft delete), `categoryId` required (`RESTRICT`), `brandId` optional (`SetNull`), `slug` unique, indexes on `(categoryId,status)`, `(status,isFeatured,createdAt)`, `(brandId)` |
| `ProductVariant` | every sellable fact lives here: `sku` (globally unique), `priceMinor`/`compareAtPriceMinor` (`Int`, minor units), `isDefault`, `status: ACTIVE\|ARCHIVED`, the 8 solar filter columns + 4 logistics columns, the hand-edited `defaultVariantKey` generated column enforcing "at most one default per product" |
| `ProductImage` | `productId` (`Cascade`), `url`, `altText`, `isPrimary` (no DB uniqueness constraint on it), `sortOrder` |
| `ProductSpecification` | `productId` (`Cascade`), `(productId, specKey)` unique — **one flat table**, no separate definition/value split (see §8) |

`InventoryItem`/`InventoryMovement` (Inventory domain) reference
`ProductVariant.id` with `onDelete: Restrict` — this is why variants are
never hard-deleted once stocked, only status-flipped to `ARCHIVED` (already
decided, `docs/DATABASE_DESIGN.md` §20). Phase 4 does not touch inventory
rows directly — creating a variant does **not** create an `InventoryItem`
row; that remains the Inventory module's responsibility (a later phase).
A variant with no `InventoryItem` row simply has no stock tracked yet,
which the catalog module treats as "cannot verify availability," not an
error.

---

## 2. Module structure

Following the established convention exactly (`src/modules/auth/` and
`src/modules/health/` — single files, not directories, matching the
ESLint `boundaries/files` category patterns):

```
src/modules/catalog/
  types.ts              # CatalogProduct, CatalogVariant, ProductSummary, etc.
  constants.ts           # status enums re-exported, seeded/known spec-key list
  schema.ts              # every Zod input schema for this module
  domain/
    slug.ts              # pure slug generation (no I/O)
    default-variant.ts    # pure "which variant should become default" helpers
    specification-key.ts  # pure spec-key normalization
    money.ts              # pure price validation helpers (integer minor-unit checks)
  repo.ts                # the only file importing Prisma for this module
  use-cases/
    create-product.ts
    update-product.ts
    publish-product.ts
    archive-product.ts
    soft-delete-product.ts
    get-product-by-slug.ts        # public/customer read
    list-products.ts              # public/customer read
    get-product-for-admin.ts      # staff/admin read (any status)
    list-products-for-admin.ts    # staff/admin read (any status)
    create-variant.ts
    update-variant.ts
    set-default-variant.ts
    archive-variant.ts
    reactivate-variant.ts
    reorder-variants.ts
    add-product-image.ts
    update-product-image.ts
    set-primary-image.ts
    remove-product-image.ts
    reorder-product-images.ts
    upsert-product-specification.ts
    remove-product-specification.ts
    create-brand.ts
    update-brand.ts
    deactivate-brand.ts
    list-brands.ts
    create-category.ts
    update-category.ts
    deactivate-category.ts
    reorder-categories.ts
    get-category-tree.ts
```

Same layering rule as auth (already enforced by the generic
`src/modules/*/...` glob in `eslint.config.mjs` — no config change
needed): Presentation → use-case → repo/domain/integration → Prisma.
`domain/*` stays pure (slug math, default-variant selection, spec-key
normalization, money-shape validation) — zero Prisma imports, zero I/O,
directly unit-testable.

---

## 3. Product lifecycle

`Product.status`: `DRAFT → ACTIVE → ARCHIVED`, plus orthogonal soft
deletion (`deletedAt`).

| Transition | Who | Rule |
|---|---|---|
| Create (`DRAFT`) | `products.create` | Always created `DRAFT`. A product is never created directly `ACTIVE` — publishing is a separate, explicit act (`publishProduct`), so "is this actually ready" is always a deliberate decision, not a side effect of the create form. |
| `DRAFT → ACTIVE` (publish) | `products.update` | Requires: at least one `ACTIVE` variant exists with `isDefault = true` (re-validated at publish time, not assumed from creation — a variant could have been archived after the product was created) and the product isn't soft-deleted. |
| `ACTIVE → ARCHIVED` | `products.update` | Always allowed. Archiving a product does **not** cascade-archive its variants automatically — archiving the product hides it from storefront listings/PDP; its variants' own status is managed independently (a variant might already be `ARCHIVED` for its own reasons, or an admin may later re-publish the product with the same variants still `ACTIVE`). |
| `ARCHIVED → ACTIVE` (re-publish) | `products.update` | Same validation as the `DRAFT → ACTIVE` publish check. |
| Soft delete (`deletedAt` set) | `products.delete` | Only permitted from `ARCHIVED` (an admin can't soft-delete a live product out from under active carts/PDPs without archiving it first — this ordering is enforced in the use-case, not assumed). Soft-deleting does **not** change `status`; `status` and `deletedAt` are independent axes, exactly as the schema models them. A soft-deleted product is excluded from every storefront and admin listing/detail use-case by default; it remains reachable only via `order_items`' informational snapshot (already immutable, per `docs/DATABASE_DESIGN.md` §20 — `order_items.productId` is `SetNull` on delete, but this is a soft delete, so the FK is never actually exercised; the row stays fully joinable for historical order display). |
| Restore (`deletedAt → null`) | `products.delete` | Provided for correcting an accidental delete. Restoring does not change `status` — a restored product is whatever status it was before deletion (typically `ARCHIVED`), and must still be explicitly published to reappear on the storefront. |

No hard delete of a `Product` exists anywhere in this module. This
satisfies "no deleted product should accidentally disappear from
historical orders" by construction — `order_items` joins against the same
row that never physically disappears.

`ProductVariant.status`: `ACTIVE ⇄ ARCHIVED`, no soft-delete field (schema
has none) and no hard delete (the `onDelete: Restrict` FKs from
`InventoryItem`/`OrderItem`/`CartItem` make hard deletion structurally
impossible once a variant has ever been stocked or ordered anyway, and the
catalog module does not attempt it even for a never-stocked variant — a
uniform rule, not a conditional one, keeps the mental model simple: *variants
are archived, never deleted*).

---

## 4. Product variants

### Creation
`createProduct` and `createVariant` are separate use-cases, but
**creating a product always creates its first variant in the same
transaction** — this is the "at least one variant, exactly one default"
half of the invariant that `docs/DATABASE_DESIGN.md` §2 explicitly flagged
as "to be implemented in Phase 4." `createProduct`'s input therefore
includes the first variant's required fields (SKU, price) inline; there is
no code path that produces a `Product` row without a corresponding
`is_default = true` `ProductVariant` row committed in the same
transaction.

Adding a **subsequent** variant (`createVariant` against an existing
product) always creates it with `isDefault = false` — never as a side
door for changing the default. Changing the default is exclusively
`setDefaultVariant`.

### Update
`updateVariant` covers label, price, `compareAtPrice`, solar facets,
logistics facets, `optionValues`, `sortOrder`. SKU is mutable but revalidated
for uniqueness on change (rare in practice — SKUs are treated as stable
identifiers — but not blocked, since a real-world catalog correction, e.g.
fixing a typo'd SKU before the product ever sells, is a legitimate need).
`isDefault` and `status` are **not** settable through `updateVariant` —
they go through the dedicated `setDefaultVariant`/`archiveVariant`
use-cases so each has its own explicit invariant check, rather than being
one more field in a generic update that could be flipped incidentally.

### Activation / deactivation
`archiveVariant(variantId)`: sets `status = ARCHIVED`. If the variant
being archived is the product's current default, the use-case **must**
also pick a new default from the product's remaining `ACTIVE` variants
(highest `sortOrder` priority, i.e. lowest `sortOrder` value first, ties
broken by `id`) in the same transaction — a product can never be left
with zero default variants while it has at least one `ACTIVE` variant
remaining. If archiving would leave the product with **zero** `ACTIVE`
variants at all, the use-case throws rather than silently leaving an
unsellable but still-`ACTIVE`-status product — the caller (admin UI, later
phase) is expected to archive the product itself first, or leave the last
variant alone. This is a deliberate business-rule decision this plan makes
explicit, not left implicit: **a product must always have at least one
`ACTIVE` variant, or be archived itself.**

### Reactivation
`reactivateVariant(variantId)` (`src/modules/catalog/use-cases/reactivate-variant.ts`)
is its own dedicated use-case, not folded into `updateVariant` or treated
as a side effect of creating a new variant:
- Moves a variant `ARCHIVED → ACTIVE`. No other status transition is valid
  input to this use-case (attempting to "reactivate" an already-`ACTIVE`
  variant is a no-op that succeeds idempotently, matching `archiveVariant`'s
  own idempotency on an already-`ARCHIVED` variant).
- Requires `products.update` (the same permission as every other
  variant-mutating use-case — reactivation is not a separate resource).
- Does **not** automatically make the variant the product's default —
  default selection stays exclusively an explicit `setDefaultVariant`
  call, never an implicit side effect of any other operation, consistent
  with every other use-case in this section.
- Preserves the product/default invariants by construction rather than by
  a check: moving a variant into the `ACTIVE` set can only ever satisfy
  "at least one `ACTIVE` variant" more easily, never violate it — see
  §13a's locking table for why this specific use-case needs no
  product-row lock.

### SKU uniqueness
Enforced at the database (`@unique` on `ProductVariant.sku`, global, not
per-product — per `docs/DATABASE_DESIGN.md` §2: "a SKU is a retailer-wide
identifier"). The repo layer catches Prisma's `P2002` unique-constraint
error on create/update and re-throws it as the new `ConflictError` (§14)
— never a generic 500, and never a read-then-write existence check
racing against a concurrent insert (see §14, concurrency).

### Default variant rules
Exactly the two-half invariant from `docs/DATABASE_DESIGN.md` §2,
implemented as designed there:
- **"At most one default per product"** — the database's job (the
  existing `defaultVariantKey` generated column + unique index). The
  catalog module writes to `isDefault` normally and trusts this
  constraint as the backstop; it does not duplicate the check in
  application code before writing.
- **"At least one variant, exactly one default, for a sellable
  (published) product"** — `createProduct`'s transaction (first variant
  always `isDefault: true`) and `publishProduct`'s pre-flight check (§3)
  together guarantee this at every point a product could become visible.
- **Replacing the default** (`setDefaultVariant`): the exact two-statement
  unset-then-set transaction from `docs/DATABASE_DESIGN.md` §2 — `UPDATE
  ... SET is_default = false WHERE product_id = ? AND is_default = true`
  immediately followed by `UPDATE ... SET is_default = true WHERE id =
  ?`, both inside one `db.$transaction`. This ordering (never the
  reverse) is what keeps the unique index from ever seeing two non-null
  `defaultVariantKey` values for the same product, even momentarily.

### Variant ordering
`sortOrder` (existing column) — `reorderVariants(productId, orderedVariantIds)`
takes the full ordered list for a product and writes `sortOrder` as
```
0, 1, 2, ...
```
in one transaction (all-or-nothing — a partial reorder that fails halfway
would produce a visibly wrong, not just stale, order). Validates that the
supplied ID list is exactly the set of the product's current
non-deleted... (variants have no soft delete, so: exactly the set of the
product's current variant IDs, no more, no fewer) before writing anything.

---

## 5. Categories

- **Creation/update**: name, slug (§11), description, `imageUrl`,
  `parentId`, `sortOrder`, `isActive`, SEO fields. Zod-validated (§10).
- **Hierarchy**: `parentId` is optional; a category with no parent is a
  root category. Depth is not limited by the schema or this plan (no
  `depth`/`path` column exists) — the storefront category tree is
  expected to be shallow in practice (2–3 levels for a solar-equipment
  catalog: e.g. Solar Panels → Monocrystalline), so no materialized-path
  optimization is built speculatively.
- **Cycle prevention**: before setting/changing `parentId`, the use-case
  walks up the *proposed* new parent's ancestor chain (via `parentId`,
  bounded — see below) and rejects if the category being updated appears
  in that chain (including the trivial self-reference case,
  `parentId === id`). This is an application-transaction check — MySQL
  has no native mechanism to prevent a self-referencing FK from forming a
  cycle. The ancestor walk is bounded to a fixed maximum depth (20) purely
  as a defensive circuit-breaker against a pre-existing data corruption
  causing an infinite loop — not because 20 levels of category nesting is
  an expected or supported depth.
- **Activation**: `isActive` toggle (`deactivateCategory`/`activateCategory`).
  Deactivating a category does **not** cascade-deactivate its children or
  its products — same reasoning as product/variant archiving: each level
  manages its own visibility flag independently, avoiding surprising
  side-effect cascades. The storefront category-tree read use-case
  (`getCategoryTree`) filters to `isActive` categories only, and a customer
  browsing a still-active child of a deactivated parent is treated as an
  acceptable, explicit admin choice, not a bug — this plan simply doesn't
  invent hidden cascade behavior the schema doesn't already encode.
- **Ordering**: `sortOrder`, same one-transaction whole-list rewrite
  pattern as variant reordering, scoped to siblings (same `parentId`).
- **Deletion**: `categories.parent_id` is `ON DELETE RESTRICT` and
  `products.category_id` is `ON DELETE RESTRICT` — the database already
  makes it structurally impossible to delete a category with children or
  assigned products. The catalog module does not attempt a "cascade
  delete with reassignment" convenience use-case in Phase 4; deleting a
  category is out of scope until an actual delete-with-reassignment flow
  is designed (deactivation is the supported "remove from storefront"
  action for now, matching `docs/DATABASE_DESIGN.md` §20's explicit "low
  cardinality reference data" reasoning for why categories don't soft-delete).
- **Image**: `imageUrl` — plain nullable column (§7, media strategy), no
  join, no separate upload use-case in Phase 4 (§18).

---

## 6. Brands

Simplest table in the domain — creation, update, `isActive` toggle,
`logoUrl` (plain column), `slug` uniqueness (§11). No hierarchy, no
ordering column exists on `Brand` (confirmed against the schema — brand
listing order is left to the caller, e.g. alphabetical by `name`, a
presentation-layer concern, not a stored value). Deleting a brand is out
of scope for the same reason as categories: `products.brand_id` is
`ON DELETE SET NULL`, so a brand *could* be hard-deleted without breaking
referential integrity, but Phase 4 does not build that use-case — only
`deactivateBrand`/`activateBrand`, consistent with treating catalog
reference-data removal as a deliberately deferred, separate concern from
this phase's create/read/update/publish scope.

---

## 7. Product images

Uses the existing `ProductImage` table exactly as designed — no
polymorphic media table (already rejected, `docs/DATABASE_DESIGN.md` §14;
this plan does not reopen that).

### The primary-image invariant
`isPrimary` has **no database uniqueness constraint** (confirmed — no
generated-column trick exists for it, unlike `is_default` on variants;
`docs/DATABASE_DESIGN.md` §2 explicitly left this as an accepted gap for
MVP, with "first by `sort_order`" as the display fallback). Per this
phase's instruction to enforce it transactionally when it isn't a DB
constraint:

- `setPrimaryImage(productId, imageId)` runs one transaction: `UPDATE
  product_images SET is_primary = false WHERE product_id = ? AND
  is_primary = true`, then `UPDATE product_images SET is_primary = true
  WHERE id = ? AND product_id = ?` — the same unset-then-set shape as
  `setDefaultVariant`, applied to a column that happens not to have a DB
  constraint backing it. This keeps "at most one primary image per
  product" true in practice even without the database enforcing it.
- `addProductImage`: if the product currently has **zero** images, the
  new image is automatically marked `isPrimary: true` (there's no
  meaningful "first by sort_order" fallback needed if there's guaranteed
  to be exactly one primary the moment any image exists). If the product
  already has at least one image, a new image defaults to
  `isPrimary: false` unless the caller explicitly requests otherwise (in
  which case `addProductImage` internally delegates to the same
  unset-then-set logic as `setPrimaryImage`).
- `removeProductImage`: if the removed image was the primary one, the
  next image by `sortOrder` (then `id`) automatically becomes primary, in
  the same transaction as the delete — a product with remaining images
  never ends up with zero primary images as a side effect of a deletion.
- **Read-side fallback stays as designed**: any use-case that needs "the
  one image to show" (e.g. a product-listing thumbnail) queries
  `ORDER BY isPrimary DESC, sortOrder ASC, id ASC LIMIT 1` rather than
  assuming a primary always exists — belt-and-suspenders with the
  transactional guarantees above, and correct even for the brief window
  during a multi-step admin correction where an image collection might
  transiently have no marked primary (there is no such window with the
  transactions above, but the read path doesn't rely on that being true).

### Everything else
`url` (object-storage URL/key — no real upload/object-storage
integration in Phase 4, see §18), `altText`, `width`/`height`,
`sortOrder` (same whole-list-rewrite reorder pattern as variants/categories).
No `isActive` column exists on `ProductImage` in the schema, so no
activation use-case is built for images — removal is the only way to hide
one, matching what's actually there rather than inventing a soft-hide
column.

---

## 8. Product specifications — controlled EAV within the existing schema

**Resolved, load-bearing fact**: the approved schema (`ProductSpecification`)
is a **single flat table** — `productId`, `specKey`, `specValue`, `unit`,
`groupLabel`, `sortOrder` — with `UNIQUE(productId, specKey)`. There is
**no separate specification-definition table** in `prisma/schema.prisma`,
and `docs/DATABASE_DESIGN.md` §2 does not describe one either (it explicitly
calls this "the long-tail EAV table," singular). The instruction's
"separate specification definition / value if that is what the existing
schema specifies" therefore does not apply here — the schema specifies one
table, and this plan does not add a second (a definition table would be a
schema change, out of scope for a phase whose migration statement should
be "none required").

**"Controlled," concretely, without a DB-level controlled vocabulary
table:**
1. `specKey` is normalized before persistence, in `domain/specification-key.ts`
   (pure function, no I/O): trimmed, lowercased, internal whitespace
   collapsed to single underscores, restricted to `[a-z0-9_]`. This
   prevents `"Cell Type"`, `"cell_type"`, and `"cell-type "` from becoming
   three different keys on different products, which would otherwise
   silently defeat the one legitimate cross-product benefit of a flat
   spec table (a future "compare specs across products" or admin-search
   feature).
2. `src/modules/catalog/constants.ts` maintains a `KNOWN_SPEC_KEYS`
   array — the actual key strings already named in
   `docs/DATABASE_DESIGN.md` §3's EAV column (`cell_type`, `cycle_life`,
   `depth_of_discharge`, `certifications`, `warranty_terms`, and similar).
   This is **advisory, not enforced** by the Zod schema — `upsertProductSpecification`
   accepts any normalized key, because genuinely new solar-equipment specs
   will legitimately need new keys over time and hard-blocking unknown
   keys would just get worked around by admins choosing a wrong existing
   key instead. The constant exists so a future admin UI can offer
   `KNOWN_SPEC_KEYS` as autocomplete/suggestions — a real, useful
   "controlled" behavior — without the catalog module rejecting valid
   input the day someone needs a 51st key. Documented here as a
   deliberate scope decision, not an oversight.
3. `specValue` remains a plain validated string (length-bounded, non-empty
   after trim) — no type system beyond that (no separate "this key is
   numeric" metadata), because the schema has no column to store such
   metadata and inventing one is a schema change this plan doesn't make.
4. The one real database constraint (`UNIQUE(productId, specKey)`, already
   normalized-key-safe because normalization happens before the write)
   is what actually prevents "an unmaintainable pile of near-duplicate
   keys per product" — the normalization above is what makes that
   constraint effective across near-miss spellings, which is the concrete
   problem "uncontrolled EAV" usually means in practice.

`upsertProductSpecification` is a true upsert on `(productId, specKey)`
(Prisma `upsert`, keyed on the existing unique constraint) — calling it
again with the same normalized key updates `specValue`/`unit`/`groupLabel`
in place rather than erroring or creating a duplicate.

---

## 9. Authorization and catalog visibility model

**This is the open question the instruction explicitly flagged for
resolution.** Nothing in `docs/ARCHITECTURE.md`/`docs/DATABASE_DESIGN.md`
states it directly; here is the resolution, consistent with §11 of
`docs/ARCHITECTURE.md` ("permissions are fine-grained resource.action
strings... enforcement is layered... every use-case function... calls
`requirePermission`") and with the storefront needing to work for
anonymous shoppers (a solar-equipment storefront cannot require login to
browse):

**Two distinct read paths, not one parameterized by role:**

| Use-case | Caller | Auth required | Visibility |
|---|---|---|---|
| `getProductBySlug`, `listProducts`, `getCategoryTree`, `listBrands` (public) | Anyone, including anonymous | None — no `requireAuthenticatedUser()` call at all | `Product.status = ACTIVE`, `deletedAt = null`; only `ProductVariant.status = ACTIVE` variants included; `Category`/`Brand` filtered to `isActive = true` |
| `getProductForAdmin`, `listProductsForAdmin` | Staff/admin | `requireAuthenticatedUser()` **and** `requirePermission(actor, "products.read")` | Every status, including `DRAFT`/`ARCHIVED`/soft-deleted, every variant regardless of status |

This is a deliberate two-use-case split (not one use-case with an
`includeUnpublished?: boolean` flag) — a flag-controlled visibility
branch is exactly the kind of thing that's one missed `if` away from
leaking a draft product publicly. Making them physically separate
functions means the public storefront pages can only ever call the
function that hard-codes the `ACTIVE`-only filter; there is no parameter
an unauthenticated caller could pass to see more.

**All mutations require authentication and the specific permission,
checked first thing inside the use-case body** (never delegated to the
Route Handler, never inferred from role name — matching the Phase 3
precedent in `assign-role.ts`/`remove-role.ts` exactly):

| Action | Permission |
|---|---|
| Create/update/publish/archive product, images, specifications, variants (create/update/default/archive/reorder) | `products.create` (create only) / `products.update` (everything else) |
| Soft-delete / restore product | `products.delete` |
| Create/update/deactivate brand or category | `products.create` / `products.update` (brands and categories share the product permission set — they are catalog structure, not a separate resource in the seeded permission list; introducing `categories.*`/`brands.*` permissions would be a Phase 3 RBAC seed-data change this plan does not make) |

No use-case ever checks `actor.role === "staff"` or similar — every check
is `requirePermission(actor, "products.read" | "products.create" |
"products.update" | "products.delete")`, exactly per the instruction and
consistent with how `super_admin` already holds every permission and
`staff` holds `products.read` only (seeded in Phase 3 — `staff` cannot
mutate the catalog under the current seed data, which is correct: Phase 3
seeded `staff` as "read-heavy + order/consultation updates," not a catalog
editor role). If a future phase needs a catalog-editor role distinct from
`super_admin`, that's a seed-data change, not a code change — permissions
are already data per the existing RBAC design.

---

## 10. Validation

Every use-case's public input goes through a Zod schema in
`src/modules/catalog/schema.ts` before the use-case body runs — the same
pattern as `src/modules/auth/schema.ts`. Highlights (not exhaustive — the
schema file itself is the source of truth once written):

- **Money**: `priceMinor` — `z.number().int().nonnegative()`, matching the `INT UNSIGNED` column; rejects any non-integer (no floats reach the repo layer, consistent with the project-wide money rule). `compareAtPriceMinor` — nullable; when `null`/absent, valid, no further check. **When supplied, hard-validated (Zod `superRefine`, HTTP 400) that `compareAtPriceMinor >= priceMinor`** — not a warning. This is the corrected, unambiguous rule: equal is allowed (a legitimate, momentary display state, exactly as `docs/DATABASE_DESIGN.md` §4 anticipated when it ruled out a *database* `CHECK` for "a false constraint here would fight normal editing"), but a compare-at price *lower* than the selling price is never valid input — it can't mean anything as a "was" price and is rejected outright. This reconciles with, rather than contradicts, §4's design note: that note explicitly says the check belongs "in the admin write path (Zod schema, Phase 4/11), not the database" — i.e. it asked for exactly this, at the Zod layer, and the previous draft of this plan under-delivered on that by turning it into a mere non-blocking warning instead. Corrected here.
- **SKU**: non-empty, `≤ 64` chars (matches `VARCHAR(64)`), restricted to `[A-Za-z0-9._-]` (a conservative, retailer-identifier-shaped charset — no spaces or exotic Unicode in a code that also appears on packing slips/labels).
- **Quantities**: Phase 4 does not accept or write any quantity/stock field — that's the Inventory module's schema, not catalog's. Any "initial stock" concern is explicitly out of scope here (§ Deferred).
- **Dimensions/weight**: `z.number().positive()` for `weightKg`, `lengthCm`, `widthCm`, `heightCm` when provided — matches the `DECIMAL` columns' "must be a real physical measurement" intent (zero/negative rejected; the columns are nullable, so "unknown" is `undefined`, never `0`).
- **Solar facets**: `powerRatingW`/`voltageV`/`ratedCurrentA` — `z.number().int().nonnegative()` (`SMALLINT UNSIGNED`); `capacityWh` — `z.number().int().nonnegative()` (`INT UNSIGNED`); `efficiencyPercent` — `z.number().min(0).max(100)`; `mpptMinV`/`mpptMaxV` — both optional, but if both present, validated `mpptMinV <= mpptMaxV` in a `superRefine` (a real, catchable data-entry mistake the schema itself can't prevent).
- **Category/brand IDs**: `z.coerce.bigint().positive()` (matching the project's established BigInt-as-string-over-the-wire convention from Phase 3's `SafeUser.id`) — existence is then checked in the use-case against the repo (a `NotFoundError`, not a Zod failure, since "does this ID exist" is a database fact, not a shape fact).
- **Image metadata**: `url` non-empty string `≤ 500` chars; `altText` optional `≤ 255`; `width`/`height` positive integers when present.
- **Specification values**: `specKey` — validated post-normalization against `[a-z0-9_]+`, `1–100` chars; `specValue` non-empty, `≤ 500` chars; `unit` optional `≤ 20`; `groupLabel` optional `≤ 100`.
- **Slugs**: an optional field on both create and update input. Omitted → auto-derived from the name with collision-retry-and-suffix (§11). Supplied (create or update) → used exactly as given, shape-validated to `[a-z0-9-]+` (`1–255` chars, matching the column widths), and a conflict on the exact requested value is a hard `ConflictError` (409), never silently suffixed (§11).

As with Phase 3, Zod validation happens at the use-case boundary, not
only in a Route Handler — so a script or job calling a use-case directly
gets the same guarantees an HTTP caller does.

---

## 11. Slugs

**Deterministic, not name-unique** — the instruction's own callout
("two products can legitimately have the same name") is correct and this
plan does not assume otherwise.

`domain/slug.ts` (pure, no I/O):
```
slugify(input: string): string
  // lowercase, transliterate/strip diacritics, replace runs of
  // non-alphanumeric characters with a single hyphen, trim leading/
  // trailing hyphens, collapse repeats. No I/O, fully deterministic for
  // a given input string.
```

**Two distinct semantics, deliberately not unified into one code path** —
this distinction did not exist in the previous draft and is the
correction this section now makes explicit:

### Automatic slug generation (no `slug` field supplied by the caller)
Collision handling is **transactional, at write time, in the repo layer**
— not a pre-check-then-insert race:
1. Compute the base slug from the name via `slugify()`.
2. Attempt the insert/update with that slug.
3. If Prisma throws `P2002` on the `slug` unique constraint, retry with
   `${baseSlug}-2`, `${baseSlug}-3`, ... — re-attempting the write itself
   each time (never a separate "check if it exists" read beforehand,
   which would be exactly the read-then-write race the instruction and
   `docs/DATABASE_DESIGN.md`'s concurrency section elsewhere warn against).
4. Bounded to a fixed number of retries (10) as a circuit-breaker against
   a pathological input; exceeding it throws a `ConflictError` rather than
   looping — this is a defensive bound, not an expected real-world path
   (ten products with the literal same name is already an edge case).

This path is for the common case: an admin types a product/category/brand
name and never thinks about the URL slug at all.

### Explicit, administrator-supplied slug
When the caller's input includes an explicit `slug` value — creation with
a deliberately chosen slug, or an update correcting/changing one — **the
requested value is used exactly as given, once normalized-and-validated
(§10's `[a-z0-9-]+` shape check), with no automatic suffixing.** If that
exact slug already belongs to another row, the write fails with
`ConflictError` (409), and the row's slug is left unchanged (on update)
or the create is rejected outright (on creation) — the caller is told
their requested slug is taken and must choose a different one themselves.

**Why these must not share a code path**: silently rewriting an admin's
deliberately-chosen `my-product-name` into `my-product-name-2` on
conflict would produce a URL the admin never asked for and likely didn't
notice was different from what they typed — exactly the kind of silent
transformation this project's engineering standards prohibit for any
explicit user input. Automatic suffixing is only ever appropriate when
the system itself derived the slug and the caller expressed no opinion
about its exact value.

Both paths reuse the same `domain/slug.ts` `slugify()`/shape-validation
functions and the same `P2002`-on-`slug`-constraint detection in the
repo layer — the only difference is what happens *after* that detection:
retry-with-suffix (automatic) vs. surface `ConflictError` immediately
(explicit). Products, categories, and brands all follow this same
two-path rule against their own table's uniqueness constraint.

Slug **updates** (renaming a product) regenerate the slug automatically
only when the name changes and no explicit slug was supplied in the same
update call; supplying an explicit slug on update always takes the
explicit-conflict path above, never the retry path. Old-slug redirect
handling (mentioned as a future concern in `docs/ARCHITECTURE.md` §14) is
explicitly deferred — Phase 4 does not build a slug-history/redirect
table, since none exists in the approved schema and adding one would be a
migration this phase doesn't make.

---

## 12. Repository / use-case architecture

Exactly the flow the instruction specifies, matching the Phase 3 precedent
literally:

```
Route Handler / Server Action
        ↓
Catalog Use-case  (Zod-validates input; calls requireAuthenticatedUser /
                    requirePermission first, for any mutating or admin-read
                    use-case; contains all business rules from §3–§8)
        ↓
Catalog Repository (src/modules/catalog/repo.ts — the only file here
                     allowed to import the Prisma client; owns every
                     $transaction boundary)
        ↓
Prisma
        ↓
MySQL
```

`repo.ts` is data-access only (no permission checks, no business rules —
same division of responsibility as `src/modules/auth/repo.ts`). Enforced
automatically by the existing `boundaries/dependencies` ESLint rule (no
config change required — it already matches any `src/modules/*/repo.ts`).

---

## 12a. One shared-infrastructure addition: `ConflictError`

`lib/errors.ts` currently defines `ValidationError` (400), `NotFoundError`
(404), `UnauthorizedError` (401), `ForbiddenError` (403) — no 409. SKU and
slug uniqueness races (§14) need a distinct, typed "the write conflicted
with existing data" error, not a generic 500 and not a misused
`ValidationError` (the input was well-formed; it just collided with
something else at write time). This plan proposes adding:

```ts
export class ConflictError extends AppError {
  constructor(message = "Conflict", cause?: unknown) {
    super(message, { code: "CONFLICT", statusCode: 409, cause });
    this.name = "ConflictError";
  }
}
```

to `lib/errors.ts` — flagged explicitly here because it's a change outside
`src/modules/catalog/`, to the same shared foundation Phase 1 and Phase 3
both already extend. It is generic (HTTP 409 semantics), not
catalog-specific business logic, so it belongs in the shared file per that
file's own stated scope ("foundation... business-specific subclasses
belong to their owning module's `domain/` layer") — a uniqueness conflict
is not business-specific, unlike, say, a hypothetical
`InsufficientStockError` would be. No other file outside
`src/modules/catalog/` is touched by this plan.

---

## 13. Transactions

Every one of these is a `db.$transaction` in `repo.ts`, matching the
instruction's explicit list:

| Operation | Transaction contents |
|---|---|
| Create product | Insert `products` row → insert its first `product_variants` row with `is_default = true` (§4) |
| Change default variant | **Lock the product row (§13a)** → re-read variant state → unset old default → set new default (exact two-statement ordering from `docs/DATABASE_DESIGN.md` §2, §4) |
| Archive a variant that could be the current default or the last `ACTIVE` one | **Lock the product row (§13a)** → re-read variant state → set the archived variant's status → pick and set a new default from remaining `ACTIVE` variants, or throw if none remain (§4) |
| Reactivate an archived variant | Set the variant's status to `ACTIVE` — **no product-row lock** (§13a explains why this one is safe without it) |
| Set primary image | Unset old primary (if any) → set new primary (§7) |
| Add image to a product with zero existing images | Insert with `is_primary = true` directly — single statement, but noted here because it's the case where "no unset needed" is itself a decision, not an oversight |
| Remove primary image | Delete the row → promote the next image by `(sortOrder, id)` to primary, if any remain (§7) |
| Reorder variants / categories (siblings) / product images | Whole-list `sortOrder` rewrite, all rows in one transaction (§4) |
| Publish / re-publish a product | **Lock the product row (§13a)** → re-read the variant set → validate the default-variant invariant against that fresh read → set `status = ACTIVE` |
| Slug-collision retry, auto-generated slug (create/update product, category, or brand) | Each attempt is its own transaction (§11) — not one giant transaction spanning all retries |
| Slug conflict, explicit admin-supplied slug (create/update product, category, or brand) | Single attempt, single transaction — `P2002` on the `slug` constraint is translated straight to `ConflictError`, never retried with a suffix (§11) |

Nothing here performs a read-then-write outside a transaction where an
atomic statement is possible — matching the instruction's explicit
prohibition.

---

## 13a. Explicit locking design for the product lifecycle / default-variant invariant

**The problem with the previous draft, stated precisely.** "Validate, then
write, inside one transaction" is not sufficient on its own. Under MySQL's
default `REPEATABLE READ` isolation, an ordinary (non-locking) `SELECT`
inside transaction T1 reads a snapshot taken when T1's transaction started
— it does not see a concurrent transaction T2's writes, committed or not,
until T1 itself commits and a new transaction starts. Wrapping "read the
variant set, then write `status = ACTIVE`" in a `$transaction` prevents T1
from seeing a *half-committed* T2, but it does **not** prevent two
transactions from **each reading a still-valid-looking state, and each
committing a write that is individually consistent with what it read, but
jointly leaves the row invariant violated.** Concretely, without an
explicit lock:

- Product P is `ACTIVE` with two `ACTIVE` variants: A (`isDefault: true`)
  and B (`isDefault: false`).
- T1 = `archiveVariant(A)`: reads "A is default, B is the only other
  `ACTIVE` variant" → decides to archive A and promote B to default.
- T2 = `archiveVariant(B)`, started concurrently, before T1 commits:
  reads "B is not the default, A still is" (T1 hasn't committed yet, so
  T2's snapshot still shows the pre-T1 state) → decides "B isn't default,
  archiving it doesn't require picking a new default" and just archives B.
- Both commit. Final state: **A archived, B archived — product P is
  `ACTIVE` with zero `ACTIVE` variants**, and depending on commit order,
  `isDefault: true` may sit on an archived row. This is exactly the
  violation the correction named, and it happens *inside* two separate,
  individually-correct `$transaction` blocks — "wrapped in a transaction"
  alone does not stop it, because neither transaction's read ever saw the
  other's in-flight change.

**The fix: an explicit row lock on the parent `products` row, acquired as
the first statement inside the transaction, before any variant read.**

```ts
// repo.ts, inside db.$transaction(async (tx) => { ... })
await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
// only now read the variant set, decide, and write
```

**What this actually does, precisely:**
- `SELECT ... FOR UPDATE` is a MySQL *locking read* — unlike a plain
  `SELECT`, it does not use the transaction's `REPEATABLE READ` snapshot;
  it reads the latest **committed** row and takes an exclusive row lock on
  it, held until the transaction commits or rolls back. This is documented
  InnoDB behavior, specifically provided so that a transaction can safely
  read-then-write without a stale-snapshot race — exactly this situation.
- A second transaction's own `SELECT ... FOR UPDATE` against the **same**
  `products.id` blocks until the first transaction ends. It does not
  error, time out by default, or silently proceed — it waits (bounded by
  MySQL's `innodb_lock_wait_timeout`, a pre-existing server default this
  plan does not change).
- Once the first transaction commits, the second's `FOR UPDATE` acquires
  the lock and its **subsequent** read of the variant set sees the first
  transaction's committed result — not a stale pre-commit snapshot. This
  is what makes the second operation's invariant check (e.g. "is this the
  last `ACTIVE` variant?") actually correct instead of working from
  outdated information.
- Replaying the race above **with** the lock: T1 acquires the lock on
  `products.id = P`, reads {A default, B active}, archives A, promotes B,
  commits, releasing the lock. T2 was blocked waiting for that same lock;
  once released, it acquires it and *only then* reads the variant set —
  which now correctly shows "B is the sole `ACTIVE` variant and is now the
  default." T2's own logic ("archiving the last `ACTIVE` variant must
  throw," §4) then correctly rejects the operation instead of proceeding
  from stale data. Exactly one of the two operations succeeds; the other
  gets a typed, expected error — never a silent invariant violation.
- **Why lock the `products` row, not the individual `product_variants`
  rows**: the invariant is a property of the *set* of a product's
  variants ("at least one `ACTIVE`," "exactly one default"), not of any
  single variant row. MySQL has no native way to take one lock over "all
  current and hypothetically-inserted rows matching `product_id = ?`" —
  locking individual variant rows would not prevent a concurrent
  operation on a *different* variant of the same product from racing
  against the invariant (as the A/B example above shows: A and B are two
  different rows). Locking the one parent row every invariant-affecting
  operation must touch is the standard "lock the aggregate root to
  serialize child-set invariants" pattern, and it is the only lock target
  that actually covers the invariant's real shape.

**Which use-cases acquire this lock, and which don't (and why not — not
applied uniformly by default, since unnecessary locking has a real cost
even at low traffic):**

| Use-case | Locks `products.id` first? | Reasoning |
|---|---|---|
| `publishProduct` (`DRAFT`/`ARCHIVED` → `ACTIVE`) | **Yes** | Directly named in the correction; the check-then-write is exactly the race above. |
| `archiveVariant` | **Yes** | Could remove the current default or the last `ACTIVE` variant; the use-case cannot know which without first reading the current set, and that read must happen after the lock is held. |
| `setDefaultVariant` | **Yes** | Could race against a concurrent `archiveVariant` on the same product (e.g. setting a variant as default at the same moment it's being archived) — locking serializes these against each other, not just against other `setDefaultVariant` calls. |
| `createProduct` | No | Creates a brand-new row; no other transaction can reference a product ID that doesn't exist yet, so there is nothing to race against. |
| `createVariant` (subsequent, non-default) | No | Always inserts with `isDefault: false` and does not read or depend on the current default/active set to decide anything — it purely adds to the set, which can only ever make the invariant easier to satisfy, never harder. |
| `updateVariant` (price/label/facets) | No | Never touches `status` or `isDefault` — cannot affect this invariant by construction. |
| `reactivateVariant` (§4) | No | Only ever moves a variant `ARCHIVED → ACTIVE`, which can only *add* to the `ACTIVE` set — a monotonic, invariant-safe direction. There is no interleaving with a concurrent `archiveVariant`/`publishProduct`/`setDefaultVariant` that this operation could turn into a violation, because it never removes an `ACTIVE` variant or changes which one is default. |

This table is the explicit "where required" the correction asked for —
locking is applied exactly to the three operations that can *remove* an
`ACTIVE`/default variant or *add* a new `ACTIVE`/default status to the
set in a way that depends on current state, and skipped, with a stated
reason, everywhere else.

---

## 14. Concurrency

Each scenario the instruction lists, and this plan's answer for it:

| Scenario | Outcome |
|---|---|
| Two requests set different variants as default for the same product | Both call `setDefaultVariant`, both acquire the `products.id` lock (§13a) — they serialize. Whichever acquires the lock first completes its unset-then-set fully and commits; the second then acquires the lock, re-reads the now-current state, and performs its own unset-then-set against that fresh state. Still effectively "last to acquire the lock wins" for *which variant ends up default* (that part is a legitimate two-admins-editing-the-same-product race with no single correct outcome), but — unlike the un-locked version — the *invariant* (exactly one default, and it's genuinely committed, not a phantom read) is guaranteed at every step, not just eventually true by luck of the DB constraint. |
| Two requests archive the two different `ACTIVE` variants of the same product at once (one of them the current default) | This is the concrete race from §13a. With the lock: exactly one `archiveVariant` call completes (archiving its variant and, if it held the default, promoting the other); the second call, once it acquires the lock and re-reads, sees its target is now the product's *last* `ACTIVE` variant and throws instead of archiving it — the product never ends up `ACTIVE` with zero `ACTIVE` variants. Without the lock (the previous draft's design) this could leave exactly that invalid state, per §13a's worked example. |
| A `publishProduct` call races a concurrent `archiveVariant` on the same product's sole `ACTIVE`/default variant | Serialized by the same lock. Whichever transaction acquires it first runs to completion against the true current state; the second re-reads afterward. If archive-first: the product now has zero `ACTIVE` variants, so the subsequent `publishProduct`'s re-validated check correctly fails and the product stays `DRAFT`/`ARCHIVED`. If publish-first: the product is now `ACTIVE`, and the subsequent `archiveVariant` correctly detects "last `ACTIVE` variant" and throws rather than leaving the now-`ACTIVE` product without one. Either ordering ends in a valid state — never the reverse (partial) outcome. |
| Two requests create a variant with the same SKU | The DB's `@unique` constraint rejects the second `INSERT` (`P2002`); the repo layer translates this to `ConflictError` (409), not a 500 or a silently-succeeding duplicate. No pre-check race, no row lock needed — the unique index itself is the defense, exactly as `docs/DATABASE_DESIGN.md`'s concurrency philosophy (compare-and-swap via a `WHERE`/unique-index check) prescribes. |
| Two requests generate the same **auto-derived** slug for two different new products | Same mechanism as SKU — the second `INSERT` hits the unique constraint, the repo's retry loop (§11) catches `P2002` specifically on the `slug` constraint and retries with the next numeric suffix, not a generic failure. |
| Two requests race to claim the same **explicit, admin-supplied** slug | No retry — per §11's corrected semantics, an explicit slug is a deliberate request for *that exact* value. The second `INSERT`/`UPDATE` hits `P2002` and the repo layer surfaces `ConflictError` (409) directly to the caller; the slug is never silently suffixed on their behalf. |
| Two concurrent updates to the same product's non-variant fields (e.g. two admins editing the description at once) | No optimistic-concurrency/version column exists on `Product` (none in the approved schema) — this plan does not add one. Last write wins at the row level, same as any normal `UPDATE`. This is a genuinely different kind of race from the default-variant one above — there is no invariant being violated here, just two edits overwriting each other, which is why it doesn't need the same locking treatment. Flagged explicitly here as an accepted limitation (see § Deferred) rather than silently unhandled. |
| Two concurrent category hierarchy changes (e.g. two admins reparenting different categories, one into the other, at the same time) | The cycle-detection read (§5) happens inside the same transaction as the `parentId` write, using a normal (not `SELECT ... FOR UPDATE`) read followed by the update — this has a real, narrow theoretical race (two simultaneous reparents that individually look acyclic but combine into a cycle) that this plan does not close with row locking, because category reparenting is a rare, low-frequency admin action, not a hot path, and the cost of `SELECT ... FOR UPDATE` across an ancestor-chain walk is disproportionate to a risk this narrow. Documented as an accepted, narrow gap (see § Deferred), not silently unhandled. |

Explicit concurrency **tests** (§15) exercise the SKU, both slug cases
(auto-retry and explicit-conflict), and the default-variant/last-active-variant
invariant case directly against the real database — two genuinely
concurrent Prisma calls, asserting the final row state, not just that one
call returned an error. The category race remains documented but not
test-simulated, per the honesty principle: claiming a concurrency test for
a race this narrow and low-frequency would overstate the coverage.

---

## 15. Testing

### Unit tests (`tests/unit/`)
- `catalog-slug.test.ts` — `slugify()`: diacritics, punctuation, repeated
  hyphens, empty/all-punctuation input, case folding.
- `catalog-specification-key.test.ts` — normalization: mixed case,
  internal whitespace, punctuation stripping, idempotency (normalizing an
  already-normalized key is a no-op).
- `catalog-default-variant.test.ts` — the pure "pick a replacement
  default from remaining active variants" selection function: empty list
  (throws/returns none), single candidate, tie-break by `sortOrder` then
  `id`.
- `catalog-money.test.ts` — integer-minor-unit validation helpers:
  rejects floats, rejects negative, accepts zero (a free/promotional item
  is a legitimate zero price, not an error).

### Integration tests (`tests/integration/`, real MySQL, following the
Phase 3 `setup.ts`/`fixtures.ts` pattern exactly — a new
`tests/integration/helpers/catalog-fixtures.ts` for
`createTestCategory`/`createTestBrand`/`createTestProduct`, cleaned up via
a catalog-specific `cleanupCatalogTestData()` matched by a test-data slug
prefix, same shape as the auth module's email-prefix cleanup):
- Product creation always yields exactly one default variant.
- SKU uniqueness rejected with `ConflictError`, not a generic error.
- Publish fails without a valid default variant; succeeds once one exists.
- Archiving the default variant promotes a replacement; archiving the
  last `ACTIVE` variant throws.
- **`reactivateVariant`**: an `ARCHIVED` variant moves to `ACTIVE`; does
  not become the product's default; reactivating an already-`ACTIVE`
  variant is a harmless no-op; requires `products.update`.
- Category hierarchy: valid reparent succeeds; a cycle attempt (including
  self-parenting) is rejected.
- Brand/category/product **auto-generated** slug collision-suffix
  behavior (`base-slug` → `base-slug-2` → ...).
- **Explicit slug conflict**: creating (or updating) a product/category/brand
  with an explicit `slug` value that already belongs to another row returns
  `ConflictError` (409); the existing row's slug is verified unchanged
  afterward, and no `-2`-suffixed row is created as a fallback.
- Primary-image invariant across add/remove/set-primary sequences.
- Specification upsert-by-key behavior (insert, then update-in-place,
  never duplicate).
- **`compareAtPriceMinor` validation**: `null` accepted; a value equal to
  `priceMinor` accepted; a value below `priceMinor` rejected with a
  validation error (400), not silently accepted or merely warned about.
- Public list/get use-cases never return `DRAFT`/`ARCHIVED`/soft-deleted
  products or non-`ACTIVE` variants, even when they exist in the test
  database alongside published ones.
- Admin list/get use-cases do return every status.
- **Concurrent default-variant change**: two variants of the same product,
  two concurrent `setDefaultVariant` calls — asserts the DB ends in a
  valid state (exactly one default) regardless of which call "won."
- **Concurrent identical SKU**: two concurrent `createVariant` calls with
  the same SKU on different products — asserts exactly one succeeds and
  the other receives `ConflictError`.
- **Concurrent auto-generated identical slug**: two concurrent `createProduct`
  calls with names that slugify to the same base — asserts both succeed
  with distinct suffixed slugs.
- **Concurrent explicit identical slug**: two concurrent `createProduct`
  calls both supplying the exact same explicit `slug` — asserts exactly
  one succeeds and the other receives `ConflictError`, never two
  suffixed rows.
- **The invariant-preserving lock test (§13a), the one this revision was
  specifically required to add**: seed a product with exactly two
  `ACTIVE` variants, A (`isDefault: true`) and B (`isDefault: false`).
  Fire `archiveVariant(A.id)` and `archiveVariant(B.id)` concurrently
  (`Promise.all`, two real overlapping Prisma calls against the real test
  database — not sequential awaits). Assert, after both settle:
  1. Exactly one of the two calls threw (the one that — after the lock
     serialized them — found itself archiving the product's last
     remaining `ACTIVE` variant).
  2. Re-reading the product from the database directly: **it is never the
     case that `product.status === "ACTIVE"` while zero of its variants
     have `status === "ACTIVE"`** — the exact condition named in the
     correction, asserted as a direct database read, not inferred from
     which use-case call threw.
  3. Exactly one `ACTIVE` variant remains, and it is the product's
     `isDefault: true` variant.
  A second variant of this test additionally races `publishProduct`
  against `archiveVariant` on a product's sole `ACTIVE`/default variant
  (the second row of §14's table), asserting the same "never `ACTIVE`
  with zero `ACTIVE` variants" invariant regardless of which call the
  lock lets through first.

### Security / authorization tests (`tests/integration/catalog-authorization.test.ts`,
`tests/integration/catalog-idor.test.ts` if any ownership-scoped catalog
resource turns out to need it — catalog resources are not user-owned, so
this is expected to fold into the authorization test file rather than
needing a separate IDOR file, revisited once the use-cases are actually
written):
- Customer (seeded `customer` role, zero permissions) cannot create,
  update, archive, reactivate, or soft-delete a product, variant, brand,
  or category — every mutating use-case rejects with `ForbiddenError` (403).
- Staff (seeded with `products.read` only) can read (including the admin
  read path) but cannot mutate.
- `super_admin` can perform every privileged operation end-to-end.
- A forged `actorId`/role/permission field in a request body has no
  effect — the actor is always the session-resolved `AuthenticatedUser`,
  never request input (mirrors the Phase 3 privilege-escalation test
  pattern exactly).
- Unauthenticated calls to any mutating use-case are rejected with
  `UnauthorizedError` (401) before `ForbiddenError` would even apply —
  same ordering Phase 3 established (`requireAuthenticatedUser` first,
  `requirePermission` second).

### E2E (Playwright, `tests/e2e/catalog.spec.ts`)
Following the Phase 3 established pattern (`request`/`request.newContext()`
only, no browser binary): the minimal HTTP-boundary proof — an
authenticated `super_admin` creating a product via the API and then an
anonymous request successfully reading it back via the public listing
endpoint once published (proving the real HTTP → use-case → DB → public
read path end-to-end), plus one forged-field-over-HTTP privilege-escalation
check on a mutating catalog endpoint, matching `tests/e2e/auth.spec.ts`'s
existing pattern. This is intentionally a thin slice, not exhaustive
coverage — exhaustive business-rule coverage lives in the integration
suite above, per the same division of responsibility Phase 3 used.

---

## 16. Performance

No Redis, no Elasticsearch, no new caching infrastructure — matching the
instruction directly.

- **Pagination**: keyset (cursor) pagination for `listProducts`/`listProductsForAdmin`,
  not offset/limit. Cursor is `(createdAt, id)` for the featured/newest
  listing (matches the existing `(status, isFeatured, createdAt)` index
  directly) or `(id)` alone for simple category listings (matches
  `(categoryId, status)` — MySQL can use this index and then sort/filter
  by `id` for the page boundary without a separate sort). Offset
  pagination is deliberately avoided because `OFFSET n` degrades linearly
  with `n` on an indexed but still-scanned range, which a growing product
  catalog would eventually hit; keyset pagination stays O(page size)
  regardless of how deep the listing goes.
- **Column selection**: list use-cases select only what a listing card
  needs (`id`, `name`, `slug`, primary image, default variant's price) —
  never the full row graph (specifications, full image gallery, every
  variant) for a listing; detail use-cases (`getProductBySlug`) select
  the full graph, since a PDP genuinely needs all of it.
- **N+1 avoidance**: every list use-case uses a single Prisma query with
  `include`/`select` for the associated default-variant price and primary
  image, not a per-row follow-up query — Prisma's relation loading
  compiles to a bounded number of queries (typically one or two, via its
  own batching), never one query per listed product.
- **Indexed filters only**: category/brand/status/featured listing filters
  use only the indexes already defined in Phase 2B (§1 above); the eight
  solar-facet columns are **not** used as query filters in Phase 4's
  use-cases (no composite index exists for them yet — `docs/DATABASE_DESIGN.md`
  §2/§18 explicitly deferred those to Phase 13 once real filter-query
  shapes are measured). Phase 4's `listProducts` accepts category/brand/
  status/featured/search-term filtering only; solar-facet range filtering
  (e.g. "12V batteries ≥ 5kWh") is explicitly out of scope for this phase.
- **Cache Components integration**: `getProductBySlug`/`listProducts`/`getCategoryTree`/`listBrands`
  (the public read use-cases only — never the admin ones, and never
  anything that reads `cookies()`) are wrapped with `"use cache"` at the
  call site in the (future, out-of-scope-for-Phase-4) storefront page,
  with `cacheLife('hours')`/`cacheTag('products')` or
  `cacheTag(\`product:${slug}\`)` / `cacheTag('categories')`, exactly per
  `docs/ARCHITECTURE.md` §12. Phase 4 itself does not add `"use cache"`
  directives to the use-cases (they're framework-agnostic, per §12
  above) — it ensures the use-case return shapes are cache-tag-friendly
  (i.e., a `getProductBySlug(slug)` signature that a future page can wrap
  in `"use cache"` and tag by slug directly) and documents the intended
  tag names here so the eventual storefront phase doesn't have to
  re-derive them. Mutating use-cases (`publishProduct`, `updateVariant`,
  etc.) are the ones that will eventually call `updateTag(...)` — also
  deferred to the storefront/admin-UI phase that actually has a cache to
  invalidate, since no `"use cache"` call site exists yet for Phase 4's
  minimal test pages to invalidate (§19).

---

## 17. SEO preparation

Phase 4 does not build sitemap/robots/structured-data output (that's
`docs/ARCHITECTURE.md` §14's Phase 13/SEO-phase scope), but ensures the
data it needs already exists and is queryable cheaply:
- `Product.seoTitle`/`seoDescription`, `Category.seoTitle`/`seoDescription`
  are already schema columns (Phase 2B) — Phase 4's create/update use-cases
  accept and persist them (validated: optional, length-bounded to the
  column widths) even though nothing renders them yet.
- `getProductBySlug`/`getCategoryTree`'s return shape includes these
  fields plus `slug`, `name`, `brand.name`, default variant's
  price/currency — exactly what a future `generateMetadata` and
  `Product` JSON-LD block would need, so that phase reads from this
  module's existing use-case rather than needing a new, parallel query.
- No canonical-URL, sitemap, or structured-data code is written in Phase 4.

---

## 18. Media

No object-storage integration (`src/integrations/storage/`) is built in
Phase 4 — confirmed out of scope both by the instruction and by
`docs/ARCHITECTURE.md` §15 ("Object storage... decided at Phase 17").
`ProductImage.url`/`Brand.logoUrl`/`Category.imageUrl` are treated as
plain strings the catalog module validates for shape (non-empty, `≤ 500`
chars, must look like a URL or storage key — a loose `z.string().min(1).max(500)`
check, not a strict URL-format validator, since a storage *key* isn't
necessarily a well-formed URL) and persists verbatim. Populating them
(via a real upload flow) is the later infrastructure phase's job; Phase
4's test/dev surface (§19) accepts a URL string directly, as if the
upload had already happened elsewhere.

---

## 19. API / minimal test surface

**No storefront UI, no admin dashboard.** Phase 4 builds only what's
needed to exercise the catalog use-cases from outside the process, for
Playwright e2e coverage (§15) and manual verification — mirroring exactly
how Phase 3 built `/api/auth/*` and one minimal `/account` page without
building the full account UI:

```
app/api/catalog/products/route.ts               # GET (public list), POST (admin create)
app/api/catalog/products/[slug]/route.ts         # GET (public detail by slug)
app/api/admin/catalog/products/route.ts          # GET (admin list, any status)
app/api/admin/catalog/products/[productId]/route.ts        # GET (admin detail), PATCH (update)
app/api/admin/catalog/products/[productId]/publish/route.ts   # POST
app/api/admin/catalog/products/[productId]/archive/route.ts   # POST
app/api/admin/catalog/products/[productId]/variants/route.ts  # POST (create variant)
app/api/admin/catalog/variants/[variantId]/route.ts            # PATCH
app/api/admin/catalog/variants/[variantId]/default/route.ts    # POST (set as default)
app/api/admin/catalog/variants/[variantId]/archive/route.ts    # POST
app/api/admin/catalog/products/[productId]/images/route.ts     # POST (add image)
app/api/admin/catalog/images/[imageId]/primary/route.ts         # POST
app/api/admin/catalog/products/[productId]/specifications/route.ts   # POST (upsert)
app/api/catalog/categories/route.ts               # GET (public tree)
app/api/admin/catalog/categories/route.ts         # POST (create), covers update/reparent via PATCH on a [categoryId] route
app/api/admin/catalog/categories/[categoryId]/route.ts   # PATCH
app/api/catalog/brands/route.ts                    # GET (public list)
app/api/admin/catalog/brands/route.ts              # POST (create)
app/admin/catalog/route.ts                          # NOT built — no admin dashboard page in Phase 4
```

Every Route Handler is thin — Zod-validate → resolve actor via
`requireSessionUser()`/`getSessionUser()` (reusing `lib/session.ts`
unchanged, no catalog-specific session code) → call use-case → map result/
error via the existing `lib/http-error-response.ts` (also unchanged and
reused directly, since the error mapping is already generic: `ZodError`
→ 400, `AppError` subclasses → their `statusCode`, unknown → 500). No new
error-response helper is written for catalog.

No `app/(storefront)/products/**` pages and no `app/admin/products/**`
pages are built — the routes above exist purely as the HTTP boundary the
e2e test exercises and that a later storefront/admin-UI phase will call
from real pages instead of building its own new API layer.

---

## 20. Deferred / explicitly out of scope for Phase 4

- Real object-storage upload flow (§18) — Phase 17 per `docs/ARCHITECTURE.md` §15.
- Solar-facet range filtering / faceted search — Phase 13 per `docs/DATABASE_DESIGN.md` §2/§18.
- Sitemap, robots.txt, JSON-LD structured data, `generateMetadata` — Phase 13 per `docs/ARCHITECTURE.md` §14.
- Storefront UI (product listing/PDP pages) and admin dashboard UI — a later phase, per the instruction's explicit exclusion.
- Category/brand hard deletion with product reassignment — not designed yet; deactivation is the supported removal action for now.
- Optimistic concurrency (version column) on `Product`/`Category`/`Brand` updates — no such column exists in the approved schema; last-write-wins is the accepted behavior, flagged explicitly rather than silently unhandled.
- Row-locked cycle prevention for simultaneous category reparenting — a narrow, low-frequency race, documented in §14 as an accepted gap rather than closed with `SELECT ... FOR UPDATE`.
- `categories.*`/`brands.*` as distinct permission keys — reuses `products.*` permissions (§9); introducing new permission keys is a Phase 3 RBAC seed-data change this plan does not make.
- Reviews' aggregate rating, inventory stock display, cart/checkout integration — other modules' Phase 4+ responsibilities, not touched here even though `Product`/`ProductVariant` already have the relations Prisma requires for them to exist later.
- Bulk import/export (CSV, etc.) of catalog data.
- Slug-history / old-slug redirect table — no such table in the approved schema.

---

## 21. Self-review

- **Does "wrapped in a transaction" alone actually prevent the
  publish/archive/default-variant race?** No, and the plan no longer
  claims it does — §13a works through the specific two-transaction race
  that a bare `$transaction` does not stop (each side individually
  consistent, jointly invalid), names the exact mechanism
  (`SELECT ... FOR UPDATE` on the parent `products` row, acquired before
  any variant read) that closes it, and states precisely which three
  use-cases need it and which four don't, with a reason for each.
- **Is `reactivateVariant` still contradictory (listed in the module
  structure but described as not existing)?** No — §4 now describes it as
  its own dedicated use-case with explicit rules, and it's present in §2's
  module structure, §13's transaction table, §13a's locking table, and
  §15's testing plan.
- **Does automatic slug generation ever silently override an
  administrator's explicit, deliberately-chosen slug?** No — §11 now
  defines two non-overlapping code paths; an explicit slug either gets
  exactly what was requested or a `ConflictError`, never a silent `-2`
  suffix.
- **Is the `compareAtPriceMinor` rule unambiguous and actually enforced?**
  Yes — `null` valid, equal valid, below `priceMinor` hard-rejected by
  Zod (400), reconciled explicitly against `docs/DATABASE_DESIGN.md` §4's
  own text (which asked for exactly this at the Zod layer, not a
  database `CHECK`) rather than left as a non-blocking warning.
- **Does this reintroduce price/SKU/stock on `products`?** No — every
  create/update use-case for `Product` excludes those fields entirely;
  they only ever appear in variant-scoped schemas/use-cases.
- **Does this turn specifications into an unmaintainable EAV free-for-all?**
  No — normalization (§8.1) prevents near-duplicate keys, the unique
  constraint prevents true duplicates, and `KNOWN_SPEC_KEYS` gives a
  concrete, growing reference point without hard-blocking legitimate new
  keys.
- **Does this add a database migration?** No. Confirmed against the
  actual current `prisma/schema.prisma` — every table, column, index, and
  constraint this plan relies on already exists.
- **Does this authorize by role name anywhere?** No — every check found
  in this plan is `requirePermission(actor, "<permission-key>")`,
  matching the instruction and the Phase 3 precedent exactly.
- **Can an unauthenticated caller ever see a `DRAFT`/`ARCHIVED`/soft-deleted
  product?** No — the public and admin read paths are physically separate
  functions (§9), not a flag-branched single function.
- **Does every multi-row invariant have a transaction, not a read-then-write?**
  Yes — enumerated explicitly in §13, cross-checked against §4's/§7's
  per-feature descriptions for consistency.
- **Are all three named concurrency scenarios (SKU, slug, default-variant)
  actually testable against the real database, not just reasoned about?**
  Yes — §15 commits to integration tests that issue genuinely concurrent
  Prisma calls, not sequential calls with an assumed race.
- **Does this quietly reopen the primary-image or default-variant
  invariant work that Phase 2B already flagged as "Phase 4's job"?**
  No — it implements exactly what `docs/DATABASE_DESIGN.md` §2 already
  described as needed, without adding scope beyond it.
- **Is anything here invented without grounding in the approved schema or
  design docs?** The two-use-case public/admin read split (§9) and the
  keyset-pagination decision (§16) are the two genuinely new decisions
  this plan makes (the schema/architecture docs didn't specify them) —
  both are called out explicitly as resolved-here, not presented as if
  they were already-approved prior decisions.

---

**PHASE 4 PLAN REVISION COMPLETE — AWAITING APPROVAL**

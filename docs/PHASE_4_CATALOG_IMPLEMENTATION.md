# Phase 4 — Catalog/Product Domain Implementation Report

Status: **implemented and verified**, revised once after review. This
documents what was actually built against `docs/PHASE_4_CATALOG_PLAN.md`
(the approved, twice-reviewed plan), including three real bugs found and
fixed (two during initial implementation, one — the primary-image
concurrency gap — identified by the implementation report's own
"Known limitations" section and closed in this revision) and one
deliberate deviation from the plan's illustrative file layout (with full
justification).

**Revision note**: the original version of this report disclosed, under
"Known limitations," that the primary-image invariant had no product-row
lock, unlike the variant-default invariant. On review, this was correctly
identified as a real, closeable data-integrity gap rather than an
acceptable limitation, and §8/§9/§13 below were revised to document the
fix. The race was discovered and disclosed *before* review, in this same
report — it is not being retroactively hidden here; the original disclosure
is preserved in spirit by this note rather than deleted.

---

## 1. Database change statement

**No Phase 4 database migration was required.** `prisma/schema.prisma` and
`prisma/migrations/` are byte-for-byte unchanged from Phase 2B. Every
table, column, index, and constraint this phase relies on
(`products`, `product_variants`, `product_images`,
`product_specifications`, `brands`, `categories`) already existed. The
`defaultVariantKey` generated column and its unique index
(`uq_at_most_one_default_variant_per_product`) — the database half of the
default-variant invariant — were used exactly as designed, not modified.

---

## 2. Files created / modified

### New — catalog module (`src/modules/catalog/`)
- `types.ts` — safe, client-returnable projections (`ProductSummary`, `ProductDetail`, `CatalogVariant`, `CatalogImage`, `CatalogSpecification`, `CatalogBrand`, `CatalogCategory`, `CategoryTreeNode`, `CursorPage<T>`) and their Prisma-row-to-safe-shape mappers.
- `constants.ts` — status/permission string constants, `KNOWN_SPEC_KEYS`, pagination and retry-bound constants.
- `schema.ts` — every Zod input schema (products, variants, images, specifications, brands, categories, pagination), including the `compareAtPriceMinor >= priceMinor` and `mpptMinV <= mpptMaxV` cross-field `superRefine` checks.
- `slug.ts` — `slugify()`, `isValidSlugShape()`, `suffixSlug()` (pure, no I/O).
- `default-variant.ts` — `pickReplacementDefault()` (pure, no I/O).
- `domain/specification-key.ts` — `normalizeSpecKey()`, `isValidSpecKeyShape()` (pure, no I/O).
- `domain/money.ts` — `isValidMinorUnitAmount()`, `isValidCompareAtPrice()` (pure, no I/O).
- `repo.ts` — the only file in this module allowed to import the Prisma client; every `$transaction` and the `SELECT ... FOR UPDATE` row lock live here. **Modified in this revision**: `addProductImage`, `setPrimaryImage`, `removeProductImage` now acquire the product-row lock (§8); new private helper `findImageProductId`.
- `use-cases/` — 34 files, one per operation (full list in §4 below). Unchanged by this revision — the primary-image locking fix is entirely internal to `repo.ts`.

### New — presentation layer
- 18 Route Handlers under `app/api/catalog/**` and `app/api/admin/catalog/**`, exactly matching the plan's §19 minimal-surface list — no more, no fewer. Unchanged by this revision.

### New — tests
- `tests/unit/catalog-{slug,specification-key,default-variant,money}.test.ts` — 4 files, 32 tests. Unchanged by this revision.
- `tests/integration/catalog-{products,variants,concurrency,images-specifications,brands-categories,authorization}.test.ts` — 6 files, 69 tests (**+3 in this revision**, all in `catalog-concurrency.test.ts` — see §9).
- `tests/integration/helpers/catalog-fixtures.ts` — test data factories and cleanup, mirroring the auth module's fixture conventions. Unchanged by this revision.
- `tests/e2e/catalog.spec.ts` — 3 tests, the thin HTTP-boundary slice. Unchanged by this revision.

### Modified — shared infrastructure
- `lib/errors.ts` — added `ConflictError` (409), flagged in the plan's §12a as the one deliberate shared-infrastructure touch, for exactly the reason stated there (generic HTTP semantics, not catalog-specific business logic).
- `tests/e2e/global-teardown.ts` — extended to also clean up `Phase4E2E`-prefixed catalog rows and `phase4-e2e-`-prefixed users, alongside its existing Phase 3 cleanup.

---

## 3. Architecture

Unchanged modular-monolith layering, matching Phase 3's precedent exactly:

```
Route Handler
      │  Zod-validates input; resolves actor via requireSessionUser()
      ▼
Catalog Use-case (src/modules/catalog/use-cases/*.ts)
      │  requirePermission(actor, ...) first, then business rules
      ▼
Catalog Repository (src/modules/catalog/repo.ts)
      │  the only file here allowed to import Prisma; owns every $transaction
      ▼
Prisma → MySQL
```

Every mutating use-case takes an already-resolved `AuthenticatedUser` as
its first parameter (never a raw session token) — matching
`src/modules/auth/use-cases/assign-role.ts`'s established convention, not
re-deriving identity from `next/headers` inside the module.

### Deliberate deviation from the plan's illustrative file layout

`docs/PHASE_4_CATALOG_PLAN.md` §2 sketched `slug.ts` and
`default-variant.ts` living under `src/modules/catalog/domain/`. During
implementation, `repo.ts` needed to call both from inside its locked
transactions (§13a) — but the project's pre-existing, unchanged-since-Phase-1
`boundaries/dependencies` ESLint rule (`eslint.config.mjs`) forbids
`repo.ts` from importing anything classified as `domain`
(`src/modules/*/domain/**`), with the explicit message *"repo.ts is data
access only... it cannot import a repo, use-case, presentation, component,
domain, or job module."*

This is a real, enforced architectural rule from Phase 1, not something
this phase is free to override. Rather than either (a) silently violating
it, or (b) duplicating the pure functions as private copies inside
`repo.ts` (a DRY violation risking drift between the tested version and a
shadow copy), both files were **relocated one directory level up** —
`src/modules/catalog/slug.ts` and `src/modules/catalog/default-variant.ts`
— which removes them from the `domain` classification entirely without
changing their content, purity, or unit-test coverage. `domain/specification-key.ts`
and `domain/money.ts` stay under `domain/` unchanged, since only
`schema.ts` (unrestricted by this rule) needs them.

This is flagged explicitly here, per the standing instruction to report
rather than silently resolve any contradiction between an approved plan
and actual implementation constraints — the contradiction here was between
the plan's illustrative sub-folder placement (never itself reviewed
against this specific ESLint rule) and Phase 1's actual, enforced
boundary. Confirmed via the mandatory boundary re-verification test (§9
below) that the underlying architectural principle is intact.

---

## 4. Use-cases implemented (34 total)

**Products (10):** `create-product`, `update-product`, `publish-product`,
`archive-product`, `soft-delete-product`, `restore-product`,
`get-product-by-slug` (public), `list-products` (public),
`get-product-for-admin`, `list-products-for-admin`.

**Variants (6):** `create-variant`, `update-variant`, `set-default-variant`,
`archive-variant`, `reactivate-variant`, `reorder-variants`.

**Images (5):** `add-product-image`, `update-product-image`,
`set-primary-image`, `remove-product-image`, `reorder-product-images`.

**Specifications (2):** `upsert-product-specification`,
`remove-product-specification`.

**Brands (5):** `create-brand`, `update-brand`, `deactivate-brand`,
`activate-brand`, `list-brands` (public).

**Categories (6):** `create-category`, `update-category`,
`deactivate-category`, `activate-category`, `reorder-categories`,
`get-category-tree` (public).

`restore-product.ts`, `activate-brand.ts`, and `activate-category.ts` are
not enumerated in the plan's §2 illustrative file list (which only named
their deactivating counterparts) — each is the natural, necessary reverse
operation, documented as such in its own file header, not new scope.

---

## 5. Product lifecycle

Implemented exactly as designed: `DRAFT → ACTIVE ⇄ ARCHIVED`, with
`deletedAt` as an independent, orthogonal axis. A product is always
created `DRAFT` with its first variant `isDefault: true` in one
transaction. `publishProduct` re-validates the default-variant invariant
against fresh, lock-protected state (§7) rather than trusting whatever was
true at creation time. Soft-delete is only permitted from `ARCHIVED`.
Restore clears `deletedAt` without touching `status`. No hard delete of a
`Product` exists anywhere — `order_items` (a future phase) will always be
able to join against a still-physically-present row.

---

## 6. Variants, default-variant invariant, and the locking design

Implemented exactly per plan §4: creation always inserts `isDefault:
false` for subsequent variants; `setDefaultVariant` performs the
unset-then-set two-statement sequence; `archiveVariant` promotes a
replacement default (via the pure `pickReplacementDefault` selection) when
the archived variant held it, and refuses to archive a product's last
`ACTIVE` variant; `reactivateVariant` moves `ARCHIVED → ACTIVE` without
ever touching `isDefault`.

### The explicit row-locking mechanism (§13a), as actually implemented

`lockProductRow(tx, productId)` issues `SELECT id FROM products WHERE id =
${productId} FOR UPDATE` as the first statement inside a
`db.$transaction(async (tx) => {...})` callback, via Prisma's parameterized
`$queryRaw` tagged template (never string concatenation — confirmed safe
against SQL injection). `publishProduct`, `setDefaultVariant`, and
`archiveVariant` all acquire this lock before reading any variant state;
`createProduct`, `createVariant`, `updateVariant`, and `reactivateVariant`
deliberately do not, per the reasoning table in the plan's §13a (each can
only ever make the invariant easier to satisfy, never harder).

### A real bug found and fixed during implementation: the pre-lock snapshot leak

The first working version of `setDefaultVariant`/`archiveVariant` resolved
a variant's `productId` via a **plain** `tx.productVariant.findUnique(...)`
call *before* calling `lockProductRow`. Under MySQL's `REPEATABLE READ`
(the connection default), a transaction's consistent-read snapshot is
established at its **first plain read**, not reset by a later locking read
(`FOR UPDATE` always sees latest committed data for *its own* query, but
does not refresh the snapshot subsequent plain reads in the same
transaction will use). Because that lookup ran before the lock, it silently
poisoned every later plain read in the same transaction — including the
"read the current `ACTIVE` variant set" step the entire invariant check
depends on — with a snapshot taken *before* the lock was ever acquired.

This was caught by the concurrency integration test the plan revision
specifically required (§9 below): two genuinely concurrent
`archiveVariant` calls on a product's only two `ACTIVE` variants **both
succeeded**, each having read the other's variant as still `ACTIVE` from
its own stale pre-lock snapshot — reproducing exactly the invalid state
("`ACTIVE` with zero `ACTIVE` variants") the plan revision was written to
prevent. Debug logging confirmed the lock itself *was* being acquired and
released correctly (genuine mutual exclusion); the bug was specifically in
what the second transaction read *after* acquiring it.

**Fix**: the `productId` lookup was moved to run on `db` directly (its
own, immediately-committed, separate connection/transaction) *before*
`db.$transaction(...)` is even called, so the explicit transaction's first
statement is unconditionally the `FOR UPDATE` lock itself, with zero prior
reads to poison its snapshot. Re-ran the concurrency test suite five
consecutive times after the fix with zero failures (§9).

A second, independent bug was found in the same function during this same
testing pass: `archiveVariant` set `status: "ARCHIVED"` on the target
variant but never cleared its `isDefault` flag in the same statement.
Since `defaultVariantKey` (the generated column backing the "at most one
default" unique index) depends only on `is_default`, not `status`,
archiving a variant that held the default left `defaultVariantKey`
non-null on the now-archived row — so the subsequent promotion of a
replacement variant's `isDefault: true` collided with the unique
constraint. Fixed by combining `status: "ARCHIVED"` and `isDefault: false`
(when applicable) into one update, before any replacement is set — the
same "unset before set, never both non-null simultaneously" ordering
principle §4/§13a already established for `setDefaultVariant`, applied
here too.

Both fixes are in `src/modules/catalog/repo.ts`; both were caught by tests
written specifically to exercise the invariant, not discovered in
production or by inspection alone.

---

## 7. Categories, brands, and slugs

Category hierarchy, cycle prevention (bounded ancestor walk, rejects
self-parenting and multi-level cycles), sibling-scoped reordering, and the
public/admin visibility split are implemented exactly per plan §5.
Brand/category/product slugs follow the two-path semantics from §11
precisely: automatic generation retries with `-2`, `-3`, ... suffixes on
conflict (each attempt its own transaction); an explicit administrator-supplied
slug is attempted exactly once and any conflict surfaces as `ConflictError`
(409) with the existing row left untouched — never silently rewritten.
Both paths were verified under genuine concurrency (§9), not just
sequentially.

---

## 8. Product images and specifications

The primary-image invariant (`isPrimary` has no database constraint) is
enforced transactionally: first image on a product is automatically
primary; a later image defaults to non-primary unless explicitly
requested; removing the primary promotes the next by `(sortOrder, id)`.

### The primary-image concurrency gap — found, disclosed, and closed

The original version of this report disclosed that this invariant used no
product-row lock, unlike the variant-default invariant (§6), and flagged a
narrow theoretical race: two concurrent `setPrimaryImage`/`addProductImage`
calls on different images of the same product could, in principle, both
end up marked primary, since nothing backs this column with a unique
constraint the way `defaultVariantKey` backs `is_default`. On review, this
was correctly identified as a real, closeable data-integrity gap rather
than an acceptable limitation — the exact same class of race as the
variant-default bug in §6, on a column with no database backstop at all
(unlike variants, where the generated column at least prevents the
*worst* outcome even when the application-level race exists).

**Fix — the same product-row lock, applied to every primary-image-affecting
operation:**

- **`addProductImage`** — `data.productId` is already known (not derived
  from a prior read), so `lockProductRow(tx, data.productId)` is
  unconditionally this function's first transactional statement.
- **`setPrimaryImage(imageId)`** — the image's `productId` is resolved via
  a new `findImageProductId(imageId)` helper that runs on `db` directly
  (its own, separate, immediately-committed connection), *before*
  `db.$transaction(...)` is even called — mirroring `findVariantProductId`'s
  established fix from §6 exactly, for the identical reason: a plain read
  inside the transaction, before the lock, would poison that transaction's
  `REPEATABLE READ` snapshot for every later read in it. The transaction
  then locks the product row first, re-verifies the image still exists
  (post-lock — a concurrent `removeProductImage` could have deleted it
  while this call was waiting for the lock), and only then performs the
  unset-then-set.
- **`removeProductImage(imageId)`** — same `findImageProductId`
  pre-transaction resolution, same lock-first ordering, before reading
  whether the target image is currently primary and deciding whether to
  promote a replacement.

No Prisma schema change or migration was made — `isPrimary` remains
without a database uniqueness constraint, exactly as designed; the
invariant is now protected entirely by the application-level lock, the
same division of responsibility already established for the
default-variant invariant.

All three functions are in `src/modules/catalog/repo.ts`. The use-case
layer (`add-product-image.ts`, `set-primary-image.ts`,
`remove-product-image.ts`) is unchanged — the fix is entirely internal to
the repo layer, as it was for §6's variant fix.

Specification key normalization prevents near-duplicate spellings
("Cell Type", "cell_type", "cell-type") from becoming separate rows — the
normalization function was itself corrected during unit testing (see §10)
to actually deliver on its own documented promise (hyphens, not just
whitespace, now collapse to underscore).

---

## 9. Verification results

All commands run with Node 22.23.1 (`.nvmrc`) against the real MySQL
database (`watplux`).

| Check | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| ESLint (including architectural boundaries) | **0 issues** |
| Prettier `--check` | **all files formatted** |
| Unit tests | **52/52 passed** (20 pre-existing Phase 3 + 32 new, unchanged by this revision) |
| Integration tests | **104/104 passed** (35 pre-existing Phase 3 + 69 catalog, across 6 files — 3 new primary-image concurrency tests added in this revision) |
| Production build (`next build`) | **succeeds** — see §11 for one investigated, non-blocking build-time log artifact (unaffected by this revision) |
| Playwright e2e | **13/13 passed** (10 pre-existing Phase 3 + 3 catalog, unchanged by this revision) |
| ESLint boundary-violation re-test | **confirmed rejected three times total**: a deliberate `app/api/catalog/brands/route.ts` → `src/modules/catalog/repo.ts` import was caught (`boundaries/dependencies` error) before and after the `domain/` relocation (§3), and again after this revision's locking fix, then reverted each time |
| Security source scan | **PASS**, re-confirmed after this revision — see §12 |
| Test-database cleanliness | Confirmed via direct MySQL query: 0 leftover users/products/variants/images/categories/brands/audit-logs after the full integration suite and the e2e suite, re-verified after this revision |

### The concurrency tests specifically required by the plan revision

All in `tests/integration/catalog-concurrency.test.ts`, using genuinely
overlapping `Promise.allSettled`/`Promise.all` calls against the real
database, asserting final row state directly:

1. Two concurrent `archiveVariant` calls on a product's only two `ACTIVE`
   variants — asserts exactly one throws, and, via a direct database
   re-read, that the product is never `ACTIVE` with zero `ACTIVE`
   variants, with the correct variant left as the sole `ACTIVE` default.
2. `publishProduct` racing `archiveVariant` on a product's sole
   `ACTIVE`/default variant — asserts the same invariant, regardless of
   which side the lock lets through first.
3. Two concurrent `setDefaultVariant` calls — asserts exactly one default
   remains (never zero, never two).
4. Two concurrent `createVariant` calls with the same SKU — exactly one
   succeeds, the other gets `ConflictError`.
5. Two concurrent `createProduct` calls with the same auto-derived slug —
   both succeed with distinct, suffixed slugs.
6. Two concurrent `createProduct` calls with the same **explicit** slug —
   exactly one succeeds, the other gets `ConflictError`, never a
   silently-suffixed fallback row.
7. **(This revision)** Two concurrent `setPrimaryImage` calls on two
   different images of the same product — asserts exactly one image ends
   up primary (never zero, never two), via a direct database re-read.
8. **(This revision)** Two concurrent `addProductImage(isPrimary: true)`
   calls on the same product — asserts exactly one of the two newly
   created images ends up primary.
9. **(This revision)** `removeProductImage` on the current primary image
   racing `setPrimaryImage` on the other image — asserts the final state
   is always exactly one remaining image and it is primary, regardless of
   which side the lock lets through first (both possible orderings were
   traced by hand and confirmed to converge to this one outcome; see the
   test's inline comment for the two-ordering analysis).

Re-ran the full file **five consecutive times** both after the original
variant-locking fix (§6) and again after this revision's primary-image
locking fix, with zero failures across all ten runs, confirming both
fixes are robust, not one-time passes.

---

## 10. Bugs found and fixed during test-writing (not application-logic bugs, but real corrections)

- **`normalizeSpecKey` didn't fulfill its own documented promise.** Its
  doc comment explicitly claimed "Cell Type", "cell_type", and "cell-type"
  would all converge — but the implementation only collapsed *whitespace*
  to underscore, silently *stripping* hyphens instead of converting them.
  A unit test written directly against that promise caught the mismatch;
  fixed to also collapse hyphens to underscore.
- **A flawed test premise**, not an implementation bug: a `slugify("™®©")`
  test expected an empty result, but Unicode NFKD normalization actually
  decomposes "™" into the letters "T" and "M" — so that input wasn't
  actually a "no alphanumeric characters" case once normalized. Corrected
  the test input to `"***"`, which has no letter decomposition.
- **Two integration tests initially called mutating use-cases with
  raw, un-Zod-parsed input** (a `compareAtPriceMinor` cross-field check
  and a `specKey` normalization), which cannot fail since — matching
  `src/modules/auth`'s established precedent exactly — catalog use-cases
  trust their typed input parameter and do not re-run Zod validation
  internally; only the Route Handler (or a test standing in for one) does.
  Corrected the tests to call `schema.parse(...)` first, matching how a
  real request actually reaches the use-case, rather than weakening the
  use-case layer to defensively re-validate input a schema-compliant
  caller would never send malformed. This is stated as a deliberate,
  precedent-matching choice, not a silent gap: **catalog use-cases, like
  auth use-cases before them, are not separately Zod-hardened against a
  caller who skips the schema entirely** (e.g., a hypothetical future
  script or job calling a use-case directly with hand-built input) — the
  boundary is enforced at the Route Handler, consistently across both
  modules.

---

## 11. A build-time log artifact, investigated and confirmed harmless

`next build` logs one `HANGING_PROMISE_REJECTION` error for
`/api/admin/catalog/products` (the parameterless admin product-list `GET`
route) during the "Generating static pages" step. Investigated per
`node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`'s
"Route Handlers (`GET`)" section, which states Cache Components attempts
to prerender `GET` handlers the same way it does pages. This route calls
`requireSessionUser()` (→ `cookies()`), a genuinely dynamic API, so Next's
build-time static-shell probe correctly fails to prerender it — and that
failure is what surfaces as this log line, because the probe's rejected
promise flows through this project's own generic error-handling path.

This is **not a build failure** (`next build` completes successfully,
exit 0, all 22 routes generated) and **not a runtime defect** — the final
route manifest correctly marks `/api/admin/catalog/products` as `ƒ`
(dynamic, server-rendered on demand), and this was independently confirmed
by starting the production server and curling the route directly: an
unauthenticated request correctly returns `401` with no crash, and the
sibling public route (`/api/catalog/products`) correctly returns its
listing. No other admin `GET` route (all of which have a `[param]` path
segment) triggers this, consistent with Next's static-shell probe only
attempting parameterless routes. No code change was made for this, since
the documented mechanism for opting a segment out of prerender validation
(`export const instant = false`, used for `/account` in Phase 3) is
explicitly scoped in Next's own docs to pages/layouts, not Route Handlers,
and there is no equivalent, more-targeted opt-out documented for this
exact Route Handler case. Flagged here for engineering awareness, not
left undocumented.

---

## 12. Security source scan

A dedicated scan covered: authorization-bypass (every mutating use-case
checked individually), actor-trust (session-only, never client-supplied),
draft/archived/soft-deleted leakage on every public read path, IDOR-shaped
issues on nested resources, raw-SQL injection safety (the one `$queryRaw`
call site), error-message leakage, money/price integer integrity, and Zod
validation coverage on every mutating route.

**Result: PASS.** Full detail in the scan transcript (not reproduced
here); two non-security observations were logged for engineering
awareness rather than as findings:
- 14 of the 34 use-cases (brand/category activation toggles,
  image/specification removal, all three reorder operations,
  restore/soft-delete product, reactivate variant) have no Route Handler
  wired up — this is the plan's §19 deliberate "minimal API surface," not
  an oversight; these use-cases are exercised directly by the integration
  suite instead (§9), matching the plan's own stated division of
  responsibility between HTTP-layer and integration-layer coverage.
- Variant/image mutation routes have no cross-check tying an ID to an
  "expected" parent product, because the catalog has no
  tenant/vendor/ownership concept anywhere in the approved schema — any
  `products.update`-holding admin manages the entire catalog by design.
  Noted only as a consideration if multi-vendor support is ever added
  later; not a defect against the current, approved single-catalog design.

---

## 13. Known limitations (carried from the plan, confirmed still accurate)

- No optimistic concurrency (version column) on `Product`/`Category`/`Brand`
  non-invariant field updates — last-write-wins, an accepted limitation
  (no such column exists in the approved schema).
- Row-locked cycle prevention for simultaneous category reparenting was
  not built — a narrow, low-frequency race, documented and accepted in
  the plan's §14, not closed here. This is the one concurrency item the
  review explicitly confirmed may remain as an accepted limitation from
  the approved plan; it was deliberately left untouched by this revision.
- Solar-facet range filtering, sitemap/structured-data, real object-storage
  upload, and storefront/admin-dashboard UI remain explicitly deferred, per
  the plan's §20 — none of this phase's code depends on them.

**No longer a limitation, as of this revision**: the primary-image
invariant's unlocked race (previously listed here) is closed — see §8/§9.

---

## 14. Environment variables introduced

None. Phase 4 added no new environment variable — no secret/key, no new
configuration surface.

---

## 15. Self-review

- **Does this reintroduce price/SKU/stock on `products`?** No — confirmed
  by an explicit integration test asserting the returned `ProductDetail`
  has no `priceMinor`/`sku`/`stock` property.
- **Does this add a database migration?** No — confirmed against the
  actual current `prisma/schema.prisma`; zero schema changes.
- **Does this authorize by role name anywhere?** No — every check is
  `requirePermission(actor, "<permission-key>")`; confirmed by the
  security scan's dedicated pass over all 24 mutating use-cases.
- **Can an unauthenticated caller ever see a `DRAFT`/`ARCHIVED`/soft-deleted
  product, an `ARCHIVED` variant, or an inactive brand/category?** No —
  confirmed both by direct code trace (repo.ts's hardcoded public-path
  `WHERE` clauses) and by a passing integration test that seeds both
  visible and hidden rows and asserts the public read excludes the hidden
  ones.
- **Does the product-lifecycle/default-variant invariant actually survive
  genuine concurrency, not just sequential test calls?** Yes — and this
  is the one place implementation caught a real bug the plan's own design
  was specifically written to prevent (§6); the fix was verified, not
  assumed, via five repeated runs of the concurrency suite.
- **Does automatic slug generation ever silently override an explicit
  administrator-supplied slug?** No — confirmed by both a sequential and
  a concurrent integration test asserting `ConflictError` and an unchanged
  existing row.
- **Is anything here invented without grounding in the approved plan or
  schema?** The `slug.ts`/`default-variant.ts` relocation (§3) is the one
  implementation-level decision made without prior explicit approval —
  flagged prominently here, with the specific enforced rule it was made to
  satisfy, rather than presented as if it had been pre-approved.
- **(This revision) Does the primary-image invariant now survive genuine
  concurrency, matching the variant-default fix's rigor?** Yes — the same
  `SELECT ... FOR UPDATE` product-row lock, the same pre-transaction
  `productId` resolution pattern (avoiding the exact snapshot-poisoning
  bug found in §6), and three new tests exercising real overlapping
  `Promise.allSettled` calls, re-run five consecutive times with zero
  failures.
- **(This revision) Was the category-reparent race also "fixed" as scope
  creep?** No — left untouched, exactly as the review instructed; it
  remains an accepted limitation from the approved plan (§13).
- **(This revision) Was anything beyond the primary-image lock touched?**
  No — no Prisma schema change, no migration, no new dependency, no
  storefront/admin/inventory/cart/order/checkout/Paystack code. The diff
  is confined to three functions and one new private helper in `repo.ts`,
  plus three new test cases in one existing test file.

---

**PHASE 4 REVISION COMPLETE — READY FOR FINAL REVIEW**

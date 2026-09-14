# Phase 10 — Admin Operations Dashboard: Implementation Report

Implemented against the approved `docs/PHASE_10_ADMIN_PLAN.md` and the "PHASE 10 — ADMIN OPERATIONS DASHBOARD IMPLEMENTATION APPROVAL GRANTED" authorization, in the mandated order (10A → 10H), running that domain's tests plus a full regression pass after each step. This report is honest about what was built, what was deferred, and what deviated from plan — nothing here claims a test ran that didn't.

## 1. Scope Delivered

- **10A — Admin shell**: `/admin/**` route tree moved outside the storefront's chrome via a `(storefront)` route group; `app/admin/layout.tsx` (auth gate + permission-aware nav), `AdminHeader`/`AdminNavLinks`/`AdminAccountMenu`, mobile nav reusing the storefront's existing `MobileNav`.
- **10B — Dashboard** (`/admin`): read-only operational overview — orders (total, by-status, paid revenue), payments (pending, failed, refunded), catalog/inventory (active products, low-stock count), customers (active, new-in-30-days) — each section gated on its own permission, each metric backed by a new thin use-case wrapping a new repo query in the module that owns the data.
- **10C — Orders admin**: `/admin/orders` (status/date-range/order-number/customer-email filters, cursor pagination) + `/admin/orders/[orderId]` (items, addresses, status history, payment attempts, cancel/retry, refund request).
- **10D — Inventory admin**: `/admin/inventory` (low-stock filter, cursor pagination) + `/admin/inventory/[variantId]` (balance, movement history, restock/adjust/return forms).
- **10E — Payments admin**: `/admin/payments` (reconciliation overview) + `/admin/payments/refunds` (admin-wide refund queue, status filter, cancel action).
- **10F — Catalog admin**: `/admin/catalog/products` (list/filter/cursor pagination), `/admin/catalog/products/new` (create, React Hook Form), `/admin/catalog/products/[productId]` (edit + variant/image/specification management), `/admin/catalog/categories`, `/admin/catalog/brands`.
- **10G — Customer detail**: `/admin/customers/[userId]` only — profile + role assign/remove.
- **10H — Verification**: `tests/e2e/admin.spec.ts`, full Phase 3–9 regression, direct database cleanliness check, this report.

**Audit Logs was NOT implemented** — deferred per Q1 (see §17).

## 2. Files Created

**Admin shell / dashboard**
`app/admin/layout.tsx`, `app/admin/page.tsx`, `components/admin/admin-nav-links.ts`, `components/admin/admin-header.tsx`, `components/admin/stat-card.tsx`, `app/admin/_components/admin-account-menu.tsx`, `app/(storefront)/layout.tsx` (route-group extraction of storefront chrome out of the root layout).

**Orders admin**
`app/admin/orders/page.tsx`, `app/admin/orders/[orderId]/page.tsx`, `app/admin/orders/[orderId]/not-found.tsx`, `components/admin/order-filter-form.tsx`.

**Inventory admin**
`app/admin/inventory/page.tsx`, `app/admin/inventory/[variantId]/page.tsx`, `app/admin/inventory/[variantId]/not-found.tsx`, `components/admin/inventory-filter-form.tsx`, `components/admin/inventory-mutation-forms.tsx`.

**Payments admin**
`app/admin/payments/page.tsx`, `app/admin/payments/refunds/page.tsx`, `components/admin/refund-filter-form.tsx`, `components/admin/refund-actions.tsx`, `src/modules/payment/use-cases/list-refunds-for-admin.ts`, `app/api/admin/payments/refunds/route.ts`.

**Catalog admin**
Pages: `app/admin/catalog/products/page.tsx`, `app/admin/catalog/products/new/page.tsx`, `app/admin/catalog/products/[productId]/page.tsx`, `app/admin/catalog/products/[productId]/not-found.tsx`, `app/admin/catalog/categories/page.tsx`, `app/admin/catalog/brands/page.tsx`.
Components: `components/admin/catalog-sub-nav.tsx`, `product-filter-form.tsx`, `product-create-form.tsx`, `product-edit-form.tsx`, `product-lifecycle-actions.tsx`, `variant-manager.tsx`, `image-manager.tsx`, `specification-manager.tsx`, `category-manager.tsx`, `brand-manager.tsx`.
Use-cases: `src/modules/catalog/use-cases/get-category-tree-for-admin.ts`, `list-brands-for-admin.ts`.
Routes: `app/api/admin/catalog/variants/[variantId]/reactivate/route.ts`, `app/api/admin/catalog/images/[imageId]/route.ts`, `app/api/admin/catalog/products/[productId]/specifications/[specKey]/route.ts`, `app/api/admin/catalog/categories/[categoryId]/activate/route.ts`, `.../deactivate/route.ts`, `app/api/admin/catalog/brands/[brandId]/route.ts`, `.../activate/route.ts`, `.../deactivate/route.ts`.

**Customer detail**
`app/admin/customers/[userId]/page.tsx`, `app/admin/customers/[userId]/not-found.tsx`, `components/admin/role-management-form.tsx`.

**Dashboard-metric use-cases** (one per owning module)
`src/modules/order/use-cases/get-order-metrics.ts`, `src/modules/payment/use-cases/get-payment-metrics.ts`, `src/modules/inventory/use-cases/get-low-stock-count.ts`, `src/modules/catalog/use-cases/get-product-count.ts`, `src/modules/auth/use-cases/get-customer-metrics.ts`.

**Tests**
`tests/integration/admin-dashboard-metrics.test.ts`, `admin-order-filters.test.ts`, `admin-refund-queue.test.ts`, `admin-catalog-reads.test.ts`, `tests/e2e/admin.spec.ts`.

**This report**: `docs/PHASE_10_ADMIN_IMPLEMENTATION.md`.

## 3. Files Modified

- `app/layout.tsx` — reduced to the true root shell (fonts, `<Toaster>`, metadata); storefront chrome moved into `app/(storefront)/layout.tsx`.
- `src/modules/order/repo.ts` / `schema.ts` / `use-cases/list-orders-for-admin.ts` — additive `dateFrom`/`dateTo`/`orderNumber`/`customerEmail` filters (§12).
- `src/modules/inventory/repo.ts` — `countLowStockItems()` (dashboard metric).
- `src/modules/payment/repo.ts` / `types.ts` / `schema.ts` — admin-wide refund queue (`listRefundsForAdmin`, `CursorPage<T>`, cursor codec).
- `src/modules/catalog/repo.ts` — `countActiveProducts()` (dashboard metric); no other repo changes (`listAllCategories(publicOnly)`/`listBrands(publicOnly)` already existed).
- `src/modules/auth/repo.ts` — `getCustomerMetrics()`.
- `app/api/admin/catalog/products/route.ts` — added `POST` (was `GET`-only).
- `app/api/admin/catalog/categories/route.ts` — added `GET` (admin tree, `publicOnly=false`).
- `app/api/admin/catalog/brands/route.ts` — added `GET` (admin list, `publicOnly=false`).
- `app/admin/orders/[orderId]/page.tsx` — added refund-request UI to the payment-attempts section (10E).
- `tests/e2e/global-teardown.ts` — added the Phase 10 cleanup block (see §13 — this was itself a bug found during this phase, not carried over from an earlier one).
- `package.json` / `package-lock.json` — added `react-hook-form`, `@hookform/resolvers` (approved, §17).
- ~14 files across the storefront — added `nativeButton={false}` to `Button`/`render={<Link/>}` usages (user-reported console warning, fixed mid-Phase-10A, unrelated to admin feature work).
- 4 files — fixed absolute imports broken by the `(storefront)` route-group move.

## 4. Routes Created

| Method | Route | Use-case |
|---|---|---|
| POST | `/api/admin/catalog/products` | `createProduct` (was unwired) |
| POST | `/api/admin/catalog/variants/[variantId]/reactivate` | `reactivateVariant` (was unwired) |
| PATCH/DELETE | `/api/admin/catalog/images/[imageId]` | `updateProductImage`/`removeProductImage` (were unwired) |
| DELETE | `/api/admin/catalog/products/[productId]/specifications/[specKey]` | `removeProductSpecification` (was unwired) |
| POST | `/api/admin/catalog/categories/[categoryId]/activate` \| `/deactivate` | `activateCategory`/`deactivateCategory` (were unwired) |
| GET | `/api/admin/catalog/categories` | `getCategoryTreeForAdmin` (new) |
| PATCH | `/api/admin/catalog/brands/[brandId]` | `updateBrand` (was unwired) |
| POST | `/api/admin/catalog/brands/[brandId]/activate` \| `/deactivate` | `activateBrand`/`deactivateBrand` (were unwired) |
| GET | `/api/admin/catalog/brands` | `listBrandsForAdmin` (new) |
| GET | `/api/admin/payments/refunds` | `listRefundsForAdmin` (new) |

Every route marked "(was unwired)" calls a **pre-existing Phase 4 use-case** that had zero HTTP route before this phase — mechanical wiring, no new business logic, following the exact thin-passthrough shape of every sibling route already in the codebase.

## 5. Backend Extensions

Five genuinely new reads/writes, all additive, all gated by **existing** permissions, all with **zero schema change**:

1. **Dashboard metrics** — 5 new use-cases (`getOrderMetrics`, `getPaymentMetrics`, `getLowStockCount`, `getProductCount`, `getCustomerMetrics`), each a thin `requirePermission` wrapper around a new repo query (`groupBy`/`count`/`aggregate`) in the module that owns the table.
2. **Order list filters** — `dateFrom`/`dateTo`/`orderNumber`/`customerEmail` added to `listOrdersForAdmin` (§12/§28.5 of the plan). Composed into the existing cursor query via an `AND: Prisma.OrderWhereInput[]` array (see §14 bug #2).
3. **Admin-wide refund queue** — `listRefundsForAdmin`, keyset-paginated on `(requestedAt, id)`, `payments.read`-gated (§14/§28.6).
4. **Admin category/brand reads** — `getCategoryTreeForAdmin`/`listBrandsForAdmin`, both `products.read`-gated, both just the existing `listAllCategories(false)`/`listBrands(false)` repo calls that no use-case had ever invoked with `publicOnly=false` (§10/§28.4).
5. **Mechanical route completion** — 9 routes (see §4) for use-cases that already existed and were already integration-tested in Phase 4; only the HTTP layer was added.

## 6. Permissions Used

Exactly the 14 pre-existing permissions. No new permission was created.

| Permission | Used by |
|---|---|
| `products.read` | Catalog list/detail, category/brand admin reads, dashboard product count |
| `products.create` | Product/variant/image create |
| `products.update` | Product/variant/image/spec/category/brand update, publish/archive/(de)activate |
| `products.delete` | *(not used — soft-delete/restore screens were not built, out of the approved screen list)* |
| `inventory.read` | Inventory list/detail, dashboard low-stock count |
| `inventory.adjust` | Restock/adjust/return |
| `orders.read` | Order list/detail, dashboard order metrics |
| `orders.update` | Cancel/retry (via the pre-existing storefront routes' elevated-permission branch) |
| `payments.read` | Payment reconciliation, refund queue, dashboard payment metrics, order-detail payment attempts |
| `payments.refund` | Request/cancel refund |
| `users.manage` | Customer detail, role assign/remove, dashboard customer metrics |
| `consultations.read`/`consultations.update`/`settings.manage` | **Not used** — confirmed orphaned, per instruction not to repurpose them |

## 7. Schema Impact

**None.** `prisma/schema.prisma` was not touched. No migration was created. No seed data changed.

## 8. Tests

New integration tests (all real MySQL, no mocked repositories):

| File | Tests | Covers |
|---|---|---|
| `admin-dashboard-metrics.test.ts` | 17 | Auth matrix + real-state assertions for all 5 metrics |
| `admin-order-filters.test.ts` | 8 | Date/order-number/customer-email filters, cursor-pagination-preserves-filter regression |
| `admin-refund-queue.test.ts` | 6 | Auth matrix, status filter, cursor pagination, cancelled-status reflection |
| `admin-catalog-reads.test.ts` | 6 | Auth matrix, inactive-category/brand visibility (admin vs. public) |

37 new integration tests. Combined with pre-existing suites: **339 integration tests, 40 files, all passing.**

`tests/e2e/admin.spec.ts` — 14 tests across 6 `describe` blocks (shell/access-control, catalog CRUD, inventory, orders, payments/refunds, customer/roles) covering all 10 scenario categories named in the approval (super_admin dashboard access, staff permitted-section access, staff-cannot-access-customers, unauthorized-direct-URL rejection, catalog CRUD, inventory restock/adjustment/return, order list/detail/cancellation, payment reconciliation, refund request/cancellation, customer detail + role management). **No Audit Log e2e test exists**, per instruction.

Unit tests: **186, unchanged** — no new pure logic was extracted this phase (permission checks and formatting are covered by existing integration/unit coverage).

## 9. Concurrency Results

No new concurrency-sensitive logic was introduced — every mutation this phase's UI calls is a **pre-existing, already-concurrency-tested** use-case (`setDefaultVariant`/`archiveVariant`'s row-locking, `adjustInventoryToTarget`'s `SELECT ... FOR UPDATE`, `allocateRefund`'s guarded update). The existing concurrency suites (`inventory-concurrency.test.ts`, `order-concurrency.test.ts`, `payment-concurrency.test.ts`, `catalog-concurrency.test.ts`) all pass unchanged as part of the 339-test integration run — no regression.

## 10. E2E Results

**60/60 passing** (46 pre-existing Phase 3–9 tests + 14 new admin tests), run twice for confirmation after the global-teardown fix (§13).

## 11. Build Result

`next build`: **0 errors, 0 warnings**, run repeatedly throughout implementation (after every domain) and once more at the end.

## 12. Security Verification

- Every mutation re-verifies authorization **server-side** inside its use-case (`requirePermission` or the module's own manual `permissions.has(...)` check) — never only at the route or UI layer. Nav visibility (`admin-nav-links.ts`) is display-only, proven non-authoritative by the e2e "unauthorized direct API call" and "staff cannot access customer detail" tests.
- IDOR: every detail screen (`[orderId]`, `[variantId]`, `[productId]`, `[userId]`) resolves its record server-side; the underlying use-case's own guard rejects an unauthorized ID (confirmed for `getOrderForAdmin`/`getProductForAdmin`/`getUserProfile` — none accept a client-asserted ownership claim).
- No credential/secret exposure: customer detail exposes only `SafeUser` (`id`/`email`/`name`); payment/refund screens never render `rawWebhookPayload`/`paystackRefundReference`/Paystack secret key.
- No client-authoritative business state: every price/status/total the admin UI displays came from a server read; every mutation sends only the same narrow fields the existing Zod schemas already accepted.
- e2e-proven: a customer's forged-permission direct API call to a new admin route is rejected (403) before touching the DB; an unauthenticated visitor is redirected before session resolution; staff (lacking `users.manage`) cannot retrieve a stranger's customer-detail data via direct URL entry (verified by inspecting the actual response — see the Cache Components finding, §14 bug #3).

## 13. Database Cleanliness

Verified by **direct Prisma query** against the test database after the full regression run (not by trusting `afterAll`/teardown alone), per instruction:

```json
{
  "phase10Users": 0, "phase10Products": 0, "phase10Categories": 0, "phase10Brands": 0,
  "anyExampleTestUsers": 0, "anyExampleComUsers": 0, "phase4TestProducts": 0,
  "curlLeftovers": 0, "orphanCarts": 0,
  "totalUsers": 0, "totalOrders": 0, "totalProducts": 0,
  "totalPaymentAttempts": 0, "totalRefunds": 0, "totalInventoryItems": 0
}
```

Every table is empty — zero test residue of any kind.

**The pre-existing Phase 9 `audit_logs` test-cleanup technical debt was NOT touched or fixed**, per explicit instruction — it remains separately tracked, unrelated to this phase's own cleanliness (this phase's e2e tests never write `audit_logs` rows at all, since neither catalog nor order mutations write audit logs, confirmed in the Phase 10 plan's own grounding).

## 14. Bugs Discovered

1. **Missing Phase 10 e2e teardown block** — `tests/e2e/global-teardown.ts` had a per-phase cleanup block for Phases 3–9 but none for the new `phase10-e2e-`/`Phase10E2E` prefixes `admin.spec.ts` introduces. Found via the mandated direct-database check after the first `admin.spec.ts` run left residue. **Fixed**: added a Phase 10 block following the exact established pattern (this is new test infrastructure introduced within this same phase, not pre-existing debt from an earlier phase, so fixing it required no cross-phase decision).
2. **Self-caught, never shipped**: an early draft of the extended `listOrdersForAdmin` spread two separate `{OR: [...]}` object literals into one `where` object; the second would have silently overwritten the first (losing the customer-email filter on page 2+ of a paginated search). Caught by manual review before any test ran; fixed by restructuring into an `AND: Prisma.OrderWhereInput[]` array. A dedicated regression test (`admin-order-filters.test.ts`, "preserves the customerEmail filter across cursor pagination") now guards this.
3. **Cache Components / Partial Prerendering (PPR) behavior, not a code bug**: `/admin`'s layout-level `redirect()` (customer with zero permissions) and a thrown `ForbiddenError` (staff viewing a stranger's `/admin/customers/[userId]`) both depend on `cookies()`, which is dynamic under this Next.js version's Cache Components system. For a plain HTTP client (curl, Playwright's `request` fixture — no JS execution), the correct decision is computed but surfaces as a `NEXT_REDIRECT` marker / error `digest` **embedded in the streamed RSC payload**, not as a top-level HTTP 307/4xx status. Verified by hand (via `curl` against a running production build, inspecting the raw response body) that: (a) the redirect target and (b) the absence of any leaked stranger data are both correct — a real browser's JS runtime resolves this correctly via client-side navigation. No product code changes were needed; two e2e assertions in `admin.spec.ts` were adapted to check the RSC-embedded evidence instead of the HTTP-transport-level status/URL, with inline comments explaining why.

No bug required changing Phase 3–9 business behavior; nothing here triggered a hard-stop.

## 15. Deviations

1. **Customer roles are not displayed** on `/admin/customers/[userId]` — no `getUserProfile`-adjacent read exposes a user's current role assignments (confirmed: `SafeUser` has no roles field, and no `listUserRoles`/`findUserRoles` use-case exists). Building one would be a new customer-management backend capability, which the approval (Q3) explicitly said not to add. The assign/remove-role forms work "blind" (no current-state display) — safely, since `assignRoleToUser`/`removeRoleFromUser` are genuinely idempotent (`upsert`/`deleteMany`), verified by reading the repo functions directly before asserting this in the UI copy.
2. **No drag-and-drop reordering** for variants/images/categories — the existing `reorderVariants`/`reorderProductImages`/`reorderCategories` whole-list-rewrite use-cases were not wired to any route or UI. Instead, each item's existing edit form exposes its `sortOrder` as a plain number field (already accepted by `updateVariant`/`updateProductImage`/`updateCategory`), giving the same practical control without new drag-interaction UI. No capability is missing; the interaction pattern is simpler than originally implied by the plan's §16.
3. **Restock's `referenceType`/`referenceId` (purchase-order linkage)** were omitted from the restock form — no purchase-order/warehouse admin feature exists in scope for these fields to meaningfully target; restocks implicitly default to no reference, exactly matching pre-Phase-10 behavior for any caller that omits them.
4. **`@hookform/resolvers`'s `zodResolver` was used successfully** (not avoided) for the product create/edit forms, via `useForm<z.input<Schema>, unknown, z.output<Schema>>()` to bridge Zod's `z.coerce.bigint()` fields — this worked cleanly on the first attempt, contrary to an initial concern that bigint coercion might force a manual-`safeParse` fallback. Simpler catalog/inventory/payment/category/brand/role forms deliberately use plain `fetch` + `useTransition` instead of RHF, per the plan's own "don't mechanically use RHF everywhere" instruction (§17) — RHF's value (typed field state, validation wiring) wasn't proportional to their smaller field counts.
5. **Category and brand management are single combined pages** (list + create + inline edit + activate/deactivate), not list+detail pairs — this matches the plan's own §10 screen table exactly ("Category management" / "Brand management" as one row each, not two).

## 16. Known Limitations

- **Image management is URL-input only.** No file-upload/object-storage pipeline exists anywhere in this codebase (confirmed absent at the schema, repo, and integration layers); building one is out of scope, deferred to the same future infrastructure phase `docs/PHASE_4_CATALOG_PLAN.md` §18 already deferred it to. This is the same open question as Phase 9's "image hosting/CDN decision" follow-up — carried forward untouched, not silently resolved here.
- **No LCP/INP/CLS measurement** was performed for admin pages — this is an internal operator tool, not the public storefront Phase 9's performance follow-up was scoped to; that follow-up remains open and untouched.
- Customer roles are not visible (§15.1).
- No drag-and-drop reordering (§15.2).
- Dashboard metrics are **not cached** — every read is a live, uncached query, per the approval's explicit instruction not to cache without measured justification and further approval.

## 17. Deferred Backend Gaps

Carried forward exactly as scoped by the approval — none of these were built, and none of their surrounding capabilities were silently expanded to compensate:

- **Audit-log read capability** — "Deferred: audit-log read capability" (Q1). No `listAuditLogs` use-case, repo query, or route was created. No existing audit-log writer (auth/inventory/payment) was modified. No new permission was invented for this.
- **Customer list, disable/enable account, force logout, active-session listing** — all deferred (Q3). No new customer-management backend capability was created beyond the two already-existing (`getUserProfile`, `assignRole`/`removeRole`).
- **Inventory value calculation** — explicitly omitted (Q2). No `cost_price` field, no schema change, no retail-price-based approximation was substituted.
- **Order fulfillment-status transitions** (`PROCESSING → READY_FOR_DISPATCH → SHIPPED → DELIVERED`) — no use-case exists; not built; no generic status-mutation endpoint was invented as a workaround.
- **Refund webhook processing** — completely untouched. The Phase 8 deferral (`REFUND_PENDING → REFUNDED` only via `confirmRefund`, never webhook-driven) was not reopened.

## 18. Phase 3–9 Regression Results

Run in full after every domain's implementation and once more at the very end:

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors |
| ESLint | 0 issues |
| Prettier | All files formatted (25 files auto-fixed once during 10H, all Phase 10's own new files) |
| Unit tests | 186/186 passing |
| Integration tests | 339/339 passing, 40 files (including every Phase 3–9 concurrency/authorization/IDOR suite) |
| E2E tests | 60/60 passing (46 pre-existing + 14 new) |
| Production build | 0 errors, 0 warnings |
| Direct database cleanliness | 0 residual rows across every checked table |

**No regression.** No Phase 3–9 test was modified. No earlier phase's business semantics changed.

---

**PHASE 10 IMPLEMENTATION COMPLETE — READY FOR REVIEW**

No Phase 11 until explicitly approved.

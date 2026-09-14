# Phase 10 — Admin Operations Dashboard: Architecture & Implementation Plan

**Status: PLANNING ONLY. No component, page, route, repository, use-case, migration, test, or seed data was written to produce this document.**

Every claim below was verified against the actual repository (`prisma/schema.prisma`, `src/modules/**`, `app/**`, `prisma/seed-data.ts`, `proxy.ts`) as it exists today — not against the Phase 0 architecture docs alone. Every place the code has diverged from those docs is called out explicitly in §2.

---

## 1. Executive Summary

Phase 10 builds the first Admin Operations Dashboard (`/admin`) on top of the seven backend domains built in Phases 3–9: Catalog, Inventory, Order, Payment, Auth/RBAC, and the audit-log writes those modules already perform. `proxy.ts` already reserves the `/admin` prefix (`PROTECTED_PREFIXES = ["/account", "/admin"]`) — it has simply had no UI behind it until now.

The two most consequential grounding findings, which shape this plan's scope more than anything else:

1. **Customer Management (§13) has almost no backend today.** There is no "list users," no "get user for admin" beyond the existing ownership-or-`users.manage` single-profile read, no "disable/enable account," and no "force logout another user." Only role assignment/removal (`assignRole`/`removeRole`, already permission-gated) is safely usable as-is. Every other customer-management capability the approval asks me to evaluate is a genuine, disclosed backend gap (§28), not something this plan silently implements.
2. **Catalog and Order mutations write no generic `audit_logs` row at all.** Only Auth (role changes), Inventory (restock/adjust/return), and Payment (refund lifecycle, success-after-cancellation) write to `audit_logs` — confirmed by grep, zero hits in `catalog/repo.ts` or `order/repo.ts`. Order transitions *are* separately captured in `order_status_history` (a purpose-built table, not a gap), but a product rename, price change, or category edit leaves **no trace anywhere**. The Audit Logs screen (§15) can only ever show what the table actually contains; extending catalog/order to write audit rows is documented as a backend gap (§28), not built here.

Everything else — inventory movements/low-stock, order search/filter/detail, payment-attempt/refund visibility, reconciliation flags — already has a solid, permission-gated backend contract this plan can build directly against, with the additive read/filter extensions Phase 9 already established a precedent for (by-slug reads, price-range filters) where a small gap exists (e.g., admin order date-range filtering).

**Zero database migrations. Zero new permissions** — the existing 14-key permission set, seeded to exactly two non-customer roles (`staff`, `super_admin`), is sufficient for every screen this plan proposes.

## 2. Current-State Grounding (code as of this writing; divergences from docs called out)

### 2.1 RBAC — exact, current seed data (`prisma/seed-data.ts`)

```
PERMISSIONS (14): products.read, products.create, products.update, products.delete,
                   inventory.read, inventory.adjust,
                   orders.read, orders.update,
                   payments.read, payments.refund,
                   consultations.read, consultations.update,
                   settings.manage, users.manage

customer:     (no permissions)
staff:        products.read, inventory.read, orders.read, orders.update,
              payments.read, consultations.read, consultations.update
super_admin:  ALL 14 permissions
```

`consultations.*` and `settings.manage` are seeded but **orphaned** — no module consumes them (`ServiceRequest`/`Settings` are schema-only, confirmed unimplemented in Phase 9's own grounding, unchanged since). This directly bounds §22's out-of-scope list: no settings screen, no consultation queue, in Phase 10.

**Divergence from `docs/ARCHITECTURE.md` §11**: the doc's illustrative example roles ("`support` + `inventory_manager`") do not exist — only `customer`/`staff`/`super_admin` are seeded. Not a contradiction (the doc was illustrating multi-role *capability*, which the schema does support), just worth noting so this plan isn't read as targeting roles that aren't there.

### 2.2 Enforcement pattern (confirmed identical across every module, Phases 3–9)

Every mutating and every sensitive read use-case calls `requirePermission(actor, KEY)` (throws `ForbiddenError`, 403) or the ownership-or-elevated-permission template (`isOwner = row.field === actor.id; const canX = actor.permissions.has(KEY); if (!isOwner && !canX) throw ForbiddenError`) — never a route-layer-only check, never a UI-only gate. `requireSessionUser()` (401 if no session) always runs first in every route. This plan's screens rely on exactly this pattern for every action; no new authorization primitive is introduced.

### 2.3 Audit logging — exact current behavior

`audit_logs` schema (`before_data`/`after_data` as two JSON columns, `entity_id` deliberately not a real FK, per `docs/DATABASE_DESIGN.md` §15 — this is the accurate description; `docs/ARCHITECTURE.md` §11's mention of a single `diff` field is the imprecise one). Confirmed by grep, only these repos write to it:
- `src/modules/auth/repo.ts` — role assignment/removal, user-entity actions.
- `src/modules/inventory/repo.ts` — restock, adjustment, return.
- `src/modules/payment/repo.ts` — refund allocate/confirm/release, "payment succeeded after cancellation" reconciliation flag.

**No read use-case exists for `audit_logs` at all** — no `listAuditLogs`, no repo query, no route. This is a genuine backend gap (§28), not an oversight to quietly work around.

Order status transitions have their **own** dedicated table (`order_status_history`: `fromStatus`, `toStatus`, `actorType`, `actorId`, `note`, `createdAt`) — already fully populated by every order transition and already returned inside `OrderDetail.statusHistory`. This is not a gap; it's a separate, already-working mechanism the Order admin screen (§12) uses directly.

### 2.4 Customer/session data — exact schema

`User`: `id, email, emailVerifiedAt, phone, passwordHash, name, status (ACTIVE|SUSPENDED), deletedAt, createdAt, updatedAt` — `status` and `deletedAt` already exist as columns; no use-case reads or writes `status` anywhere today (registration always creates `ACTIVE`). `Session`: `id, userId, sessionTokenHash, userAgent, ipAddress, expiresAt, createdAt` — no explicit revocation flag, sessions are TTL-only; `authRepo.deleteAllSessionsForUser(userId)` already exists as a repo primitive but is only ever invoked by `logoutAll`, which is self-service-only (takes a raw session token, never a target `userId`). `getUserProfile(requester, targetUserId)` already implements the correct ownership-or-`users.manage` IDOR pattern for reading **one** user — but there is no **list** users use-case at any permission level.

### 2.5 Existing admin API surface (exhaustive, confirmed by listing `app/api/admin/**`)

```
catalog:    products (list/create), products/[id] (get/update), products/[id]/{archive,publish,images,specifications,variants},
            variants/[id] (update), variants/[id]/{archive,default}, images/[id]/primary,
            categories (create), categories/[id] (update), brands (create)
inventory:  GET / (list), GET /[variantId] (balance), /[variantId]/{adjust,restock,return,movements}
orders:     GET / (list, status filter only), GET /[orderId] (full detail)
payments:   POST /[paymentAttemptId]/refunds, POST /refunds/[refundId]/cancel, GET /reconciliation
users:      POST|DELETE /[userId]/roles  (the ONLY user-admin route that exists)
```

No admin route exists for: listing users, disabling/enabling a user, forcing logout, listing/filtering by date range on orders, or reading audit logs. Every one of these is either a documented backend gap (§28) or a small, precedented additive extension this plan proposes building (mirroring Phase 9's own price-range/by-slug additive-extension pattern).

### 2.6 Design system / layouts available to reuse

`components.json`: shadcn `base-nova` style, Tailwind v4, `lucide-react`, Base UI-backed primitives (confirmed in Phase 9: `render` prop, not Radix `asChild`). Already installed: `button, card, badge, input, select, checkbox, dialog, sheet, dropdown-menu, table, skeleton, alert, sonner, separator, tabs, breadcrumb, label, textarea`. `app/layout.tsx` currently renders the **storefront** header/footer unconditionally — an admin route tree needs its own layout that does *not* inherit the storefront chrome (§5). `app/account/page.tsx` remains the only precedent for a protected, `instant = false`, session-gated page.

## 3. Scope

Screens for the seven areas named in the approval (A–G): Dashboard, Catalog, Inventory, Orders, Customers, Payments, Audit Logs — built as thin presentation over the existing use-case contracts, plus the small set of additive backend reads this plan proposes (§7, all listed explicitly, all additive, zero migrations).

## 4. Non-goals

Everything in §22 of the approval message, verbatim: refund-webhook implementation, chargebacks/disputes, accounting, shipping/fulfillment/warehouse management, notification infrastructure, CRM, marketing automation, coupon engine, review moderation (no backend to moderate), advanced analytics/data warehouse, Redis, Elasticsearch/OpenSearch, a native mobile app, public storefront redesign, AI features. Also non-goals for this phase specifically: a Settings screen (permission is orphaned, no backend), a consultation queue (same reason), bulk destructive operations beyond what named use-cases already support one-at-a-time.

## 5. Admin Architecture

```
app/
  admin/
    layout.tsx              — NEW: admin shell (nav + permission-aware chrome), session-gated
    page.tsx                — NEW: dashboard (redirects to /admin/orders if it becomes the landing page — TBD at implementation time, not a planning decision)
    catalog/
      products/page.tsx             — list
      products/[productId]/page.tsx — detail/edit
      products/new/page.tsx         — create
      categories/page.tsx           — list + inline create/edit
      brands/page.tsx               — list + inline create/edit
    inventory/
      page.tsx                       — overview (all variants, low-stock filter)
      [variantId]/page.tsx           — detail + movement history + restock/adjust/return actions
    orders/
      page.tsx                       — list (status + date-range filter, search by order number)
      [orderId]/page.tsx             — detail (items, addresses, status history, payment attempts, actions)
    customers/
      page.tsx                       — list  (BACKEND GAP — §28.1)
      [userId]/page.tsx              — detail (BACKEND GAP — §28.1, partially: role mgmt works today)
    payments/
      page.tsx                       — payment-attempt / reconciliation overview
      refunds/page.tsx                — refund queue (request/cancel already-existing use-cases)
    audit/
      page.tsx                       — audit log viewer (BACKEND GAP — §28.2, no read use-case exists)
```

`app/admin/layout.tsx` is a Server Component: calls `getSessionUser()` (not `requireSessionUser()`, so it can redirect to `/login?next=...` rather than throw), redirects if absent, and renders `<AdminNav>` (permission-aware, §8) around `{children}`. It does **not** import `app/layout.tsx`'s storefront header/footer — Next's route-group-free nested layout composition already gives every `/admin/**` page the root `<html>/<body>` from `app/layout.tsx` plus this new admin-specific chrome layered inside it, without duplicating `<html>`/`<body>`. (A `(storefront)` route group to *exclude* the header/footer from `/admin/**` is the cleaner long-term shape; whether to introduce it is an implementation-time layout decision, not a planning blocker — either shape reaches the same place.) Every `/admin/**` page is Server Component by default, `instant = false` (session-gated, same convention as `app/account/page.tsx`), with Client Component leaves only for: table sort/filter controls, destructive-action confirmation dialogs, forms (create/edit product, restock/adjust, refund request), and the mobile nav drawer equivalent.

No SPA shell, no client-side router state beyond what Next's own App Router provides, no Redux/Zustand — identical discipline to Phase 9's storefront.

## 6. Route Structure

| Route | Purpose | Min. permission |
|---|---|---|
| `/admin` | Dashboard | any of the 14 (all non-customer roles land here) |
| `/admin/catalog/products` | Product list/search/filter | `products.read` |
| `/admin/catalog/products/new` | Create product | `products.create` |
| `/admin/catalog/products/[productId]` | Edit product, variants, images, specs | `products.read` (view) / `products.update` (edit) |
| `/admin/catalog/categories` | Category tree management | `products.read` / `products.create` / `products.update` |
| `/admin/catalog/brands` | Brand management | `products.read` / `products.create` / `products.update` |
| `/admin/inventory` | Inventory overview, low-stock filter | `inventory.read` |
| `/admin/inventory/[variantId]` | Balance, movement history, restock/adjust/return | `inventory.read` (view) / `inventory.adjust` (mutate) |
| `/admin/orders` | Order list/search/filter | `orders.read` |
| `/admin/orders/[orderId]` | Order detail, payment attempts, cancel/retry | `orders.read` (view) / `orders.update` (cancel) |
| `/admin/customers` | Customer list — **backend gap, §28.1** | `users.manage` |
| `/admin/customers/[userId]` | Customer detail, roles, orders | `users.manage` (full) / ownership-or-`users.manage` already works for the profile fetch itself |
| `/admin/payments` | Payment-attempt overview, reconciliation flags | `payments.read` |
| `/admin/payments/refunds` | Refund queue (request/cancel) | `payments.read` (view) / `payments.refund` (mutate) |
| `/admin/audit` | Audit log viewer — **backend gap, §28.2** | `users.manage` (proposed — see §7) |

Every route's *actual* authorization boundary is the use-case's own `requirePermission`/ownership check — this table states the permission a screen is built to expect, not a new enforcement layer.

## 7. Permission Model

**No new permission is proposed.** Every screen maps to one or more of the existing 14 keys:

| Screen area | Read | Mutate |
|---|---|---|
| Catalog | `products.read` | `products.create` / `products.update` / `products.delete` |
| Inventory | `inventory.read` | `inventory.adjust` |
| Orders | `orders.read` | `orders.update` |
| Customers | `users.manage` (already the read/write gate for `getUserProfile`, `assignRole`, `removeRole`) | `users.manage` |
| Payments | `payments.read` | `payments.refund` |
| Audit logs | Proposed: reuse `users.manage` (see rationale below) | N/A, read-only |

**Audit-log read permission — reasoning, not a new key.** No permission cleanly says "can read the security/investigation trail" today. Two existing options were evaluated: `settings.manage` (currently orphaned, semantically "site configuration," not "investigation") and `users.manage` (already the gate for the only other cross-cutting admin-oversight capability — reading arbitrary user profiles and managing roles). `users.manage` is the closer semantic fit and is **only ever held by `super_admin`** today (confirmed: `staff` does not have it) — meaning the audit log, which can reveal sensitive operational history across every domain, is correctly restricted to the most privileged role without inventing anything. This plan does not implement the audit-log route without an explicit decision on this point (§30 Q1) since it's a judgment call the plan flags rather than resolves unilaterally.

## 8. Admin Navigation

`AdminNav` (Server Component, receives the resolved `actor.permissions` as a prop from `admin/layout.tsx`) renders a link only when the actor holds the corresponding permission — **display-only convenience, never the authorization boundary** (every linked page independently re-verifies via its own use-case, exactly per §17 of the approval). Sections: Dashboard (always shown), Catalog (`products.read`), Inventory (`inventory.read`), Orders (`orders.read`), Customers (`users.manage`), Payments (`payments.read`), Audit (`users.manage`, pending §30 Q1). A `staff` actor therefore sees Dashboard/Catalog/Inventory/Orders/Payments but not Customers/Audit — matching the seeded permission set exactly, with zero hidden capability (every hidden link's target page would also independently reject a direct-URL `staff` visit with 403, verified by the same pattern Phase 9's e2e IDOR tests already established).

## 9. Dashboard

Every metric below is derived from existing tables via a plain Prisma `count`/`aggregate`/`groupBy` — no new infrastructure, no Redis, no warehouse.

| Metric | Source | Calculation | Range | Auth | Cache |
|---|---|---|---|---|---|
| Total orders | `orders` | `count()` | all-time | `orders.read` | dynamic (§16) |
| Orders by status | `orders` | `groupBy(status)` | all-time or last 30d (toggle) | `orders.read` | dynamic |
| Revenue (paid) | `orders` | `sum(totalMinor)` where `status IN (PAID, PROCESSING, READY_FOR_DISPATCH, SHIPPED, DELIVERED)` | selectable range | `orders.read` | dynamic |
| Refunded amount | `payment_attempts` | `sum(refundedAmountMinor)` | selectable range (via `refunds.processedAt`) | `payments.read` | dynamic |
| Pending payments | `payment_attempts` | `count()` where `status IN (INITIATED, PENDING)` | current snapshot | `payments.read` | dynamic |
| Failed payment attempts | `payment_attempts` | `count()` where `status IN (FAILED, INITIALIZATION_FAILED, ABANDONED)` | selectable range | `payments.read` | dynamic |
| Low-stock products | `inventory_items` | reuses the existing `listInventoryItems({ lowStockOnly: true })` raw-SQL comparison (`quantity_available <= low_stock_threshold`) — already built, Phase 5 | current snapshot | `inventory.read` | dynamic |
| Inventory value | `inventory_items` × `product_variants.priceMinor` | **evaluated and rejected for this phase** — "value" requires a policy decision (cost basis vs. retail price vs. weighted average) this schema has no field for (no `cost_price` column anywhere); computing it from `priceMinor` alone would silently misrepresent it as a cost figure. Flagged as an open question (§30 Q2), not computed. | — | — | — |
| Active customers | `users` | `count()` where `role = customer` and `status = ACTIVE` — requires a join through `user_roles`/`roles`, still a single query | current snapshot | `users.manage` | dynamic |
| New customers | `users` | `count()` where `createdAt >= range start` | selectable range | `users.manage` | dynamic |
| Product count | `products` | `count()` where `status = ACTIVE, deletedAt: null` (matching the storefront's own public-visibility definition) | current snapshot | `products.read` | dynamic |

**Caching decision**: every metric above defaults to a **dynamic, uncached read** (per §16's explicit instruction to prefer dynamic initially) — these are admin-only, permission-gated, and the query cost of a handful of `count()`/`groupBy()`/`sum()` calls against indexed columns (`orders(status, createdAt)`, `payment_attempts(status, createdAt)`, the existing low-stock raw query) is not expected to be expensive enough to justify the complexity/staleness trade-off of caching RBAC-sensitive aggregates. If a real measurement (§21) later shows otherwise, a short (`cacheLife("minutes")`) cache **keyed by nothing user-specific** (these numbers don't vary per admin) could be introduced — explicitly not decided now, per §16's "prefer dynamic reads initially."

## 10. Catalog Management

| Screen | Route | Data source | Actions | Pagination |
|---|---|---|---|---|
| Product list | `/admin/catalog/products` | `listProductsForAdmin` (existing, cursor-paginated, already supports `status`/`includeDeleted`/search/price/facet filters from Phase 9's extension) | Create, view, edit, publish, archive | Cursor (existing) |
| Product create | `/admin/catalog/products/new` | `createProduct` | — | — |
| Product detail/edit | `/admin/catalog/products/[productId]` | `getProductForAdmin` | `updateProduct`, `publishProduct`, `archiveProduct`, `createVariant`, `updateVariant`, `archiveVariant`, `reactivateVariant`, `setDefaultVariant`, `addProductImage`, `updateProductImage`, `setPrimaryImage`, `removeProductImage`, `upsertProductSpecification`, `removeProductSpecification` | N/A (single record) |
| Category management | `/admin/catalog/categories` | `getCategoryTree` (admin variant needed — see note) or a new `listAllCategoriesForAdmin`-shaped call; `createCategory`, `updateCategory`, `setCategoryActive`, `reorderCategories` all already exist | Create, edit, (de)activate, reorder | N/A (tree, not paginated) |
| Brand management | `/admin/catalog/brands` | `listBrands` (admin needs the non-`publicOnly` variant — the repo function `listBrands(publicOnly)` already supports this; only the admin use-case/route wiring for `publicOnly=false` may be missing — verify at implementation time) | `createBrand`, `updateBrand`, `setBrandActive` | N/A (flat list) |

**Note on admin category/brand listing**: `catalogRepo.listAllCategories(publicOnly)`/`listBrands(publicOnly)` both already accept a `publicOnly` flag at the repo layer, but no *admin* use-case/route currently calls them with `publicOnly=false` (only the public `getCategoryTree()`/`listBrands()` use-cases, which hard-code `publicOnly=true`, are wired to a route today). This is a **small additive extension** (new admin use-cases `getCategoryTreeForAdmin`/`listBrandsForAdmin`, each just `requirePermission` + the existing repo call with `publicOnly=false`) — not a gap requiring new repo logic, listed precisely in §31.

**Invariants this plan explicitly preserves, never weakens for UI convenience**: the default-variant invariant (exactly one `ACTIVE` variant flagged `isDefault`, enforced by `setDefaultVariant`/`archiveVariant`'s existing locked-transaction logic) — the UI disables "archive" on a product's only remaining `ACTIVE` variant and surfaces the backend's own `ValidationError` message if the guard is somehow raced; the primary-image invariant (same shape, `setPrimaryImage`/`removeProductImage`); slug-collision behavior (explicit slug → hard conflict error surfaced verbatim; omitted slug → silent auto-suffix, the UI shows the resulting slug after creation, never lets the admin "retry" a slug conflict via a client-side loop); price/compare-at-price validation (the existing Zod schemas' cross-field checks are the only validation — the UI mirrors the same schema for client-side UX, per §13, but never invents a stricter or looser rule).

## 11. Inventory Management

| Screen | Route | Data source | Actions | Pagination |
|---|---|---|---|---|
| Overview | `/admin/inventory` | `listInventory` (existing, cursor-paginated, `lowStockOnly` filter already built via the Phase 5 raw-SQL comparison) | none (read-only list) | Cursor (existing, id-based) |
| Detail | `/admin/inventory/[variantId]` | `getInventoryForVariant` + `getInventoryMovementHistory` (existing, cursor-paginated) | `restockInventory`, `adjustInventory`, `recordInventoryReturn` | Cursor (existing, createdAt+id) |

The UI **never** writes a quantity directly — every mutation is one of the three named use-cases above, each producing a real `inventory_movements` row (RESTOCK/ADJUSTMENT/RETURN) through the existing guarded-UPDATE ledger mechanism. Available/reserved/on-hand are always rendered as three distinct, separately-labeled numbers (`quantityAvailable` — the DB-generated column, `quantityReserved`, `quantityOnHand`), never conflated into one "stock" figure. Low-stock indicator reuses the existing `lowStockOnly` filter (and, per-row, a simple client-side `quantityAvailable <= lowStockThreshold` comparison for a visual badge on the overview table — computed from data already fetched, not a second query).

## 12. Order Management

| Screen | Route | Data source | Actions | Pagination |
|---|---|---|---|---|
| List | `/admin/orders` | `listOrdersForAdmin` (existing `status` filter + cursor; **date-range filter and order-number/customer-email search are additive extensions, not currently supported** — §31) | none | Cursor (existing) |
| Detail | `/admin/orders/[orderId]` | `getOrderForAdmin` + `listPaymentAttemptsForOrder` (already admin-accessible via `payments.read`) | `cancelOrder` (via the existing `orders.update` path, same use-case the customer-facing cancel button already calls), `retryPayment` (same, existing) | N/A |

**No generic status-mutation endpoint is proposed or used.** Every transition available to the admin UI is the exact named use-case/state-machine path already in place — `cancelOrder` only ever performs `PENDING_PAYMENT|PAID → CANCELLED` (whatever the state machine already allows), `retryPayment` only ever creates a new attempt on an existing `PENDING_PAYMENT` order. If an operator needs a transition the current state machine doesn't expose (e.g., manually marking an order `PROCESSING → READY_FOR_DISPATCH` — fulfillment status changes have **no use-case at all** today, since shipping/fulfillment is out of scope for every phase so far), this plan documents it as a backend gap (§28.3) rather than inventing a `PATCH /orders/:id/status` escape hatch.

## 13. Customer Management

Grounded against §2.4's findings — this section is scoped much more conservatively than the approval's evaluation list, because the backend mostly isn't there yet:

| Capability | Status | Plan |
|---|---|---|
| Customer list (search/paginate) | **Backend gap** — no `listUsers`/`listUsersForAdmin` use-case or repo query exists | Document as gap (§28.1); propose the shape (cursor-paginated, `users.manage`-gated, matching every other admin list's convention) without building it |
| Customer detail | Partially exists — `getUserProfile(actor, targetUserId)` already supports `users.manage` admin access to any single profile | Build the detail screen against this existing use-case |
| Order history (per customer) | Exists — `listOrdersForAdmin` has no `userId` filter today, but `listMyOrders`-shaped logic already proves the query pattern; needs a small additive filter, not new architecture | Document as a small additive extension (§31) |
| Payment history (per customer) | Same as above — no direct "payments by user" query exists; would need to join through orders | Document as additive extension, lower priority |
| Audit history (per customer) | Blocked on §28.2 (no audit-log read use-case exists at all) | Deferred until §28.2 is resolved |
| Enable/disable account (`status`) | **Backend gap** — `User.status` column exists, zero use-case reads/writes it | Document as gap (§28.1) |
| Force logout (all devices) | **Backend gap, but a small one** — `authRepo.deleteAllSessionsForUser(userId)` already exists as a repo primitive; only a thin admin-facing use-case (`requirePermission(actor, "users.manage")` + call the existing repo function) is missing | Document as the smallest of the gaps in §28.1 — safe, precedented, one new use-case, zero new repo logic |
| Change roles | **Already fully supported** — `assignRole`/`removeRole`, already permission-gated | Build directly against these, no changes needed |
| Session information (list active sessions) | **Backend gap** — no `listSessionsForUser` read exists (the `sessions` table has everything needed: `userAgent`, `ipAddress`, `expiresAt`, `createdAt`) | Document as gap (§28.1) |

**Never exposed, under any circumstance**: `passwordHash`, `sessionTokenHash`, password-reset/email-verification token hashes, or any other credential material — none of these fields are present in `SafeUser` (the existing safe-projection type) or any other DTO this plan proposes reusing, and no new DTO in this plan ever adds them back.

Given the size of the gap, **the Customer Management screens in Phase 10's actual implementation will initially be limited to**: viewing a single customer's profile + role assignment (fully backed today), with the list screen, disable/enable, force-logout, and session-visibility features either deferred to a follow-up backend increment or explicitly re-scoped at implementation-approval time — this is flagged as an open question (§30 Q3), not silently resolved by this plan.

## 14. Payment Management

| Screen | Route | Data source | Actions | Pagination |
|---|---|---|---|---|
| Overview | `/admin/payments` | `listReconciliationFlags` (existing — non-authoritative-successful attempts, stuck-initiated attempts, stuck-or-failed webhook events, stuck refunds) | none | N/A (flag lists, already bounded) |
| Refund queue | `/admin/payments/refunds` | Per-order via `listPaymentAttemptsForOrder`, or a new admin-wide "refunds needing attention" read (see below) | `requestRefund`, `cancelRefund` (both existing, `payments.refund`-gated) | Depends on data source chosen |

Every field displayed (Paystack reference, status, amount, currency, order, timestamps, `errorCode`/`errorMessage`, `authoritativePaymentAttemptId`, refund ledger fields) already exists on `PaymentAttemptRecord`/`RefundRecord` — no new fields, no raw payload exposure (the plan explicitly never surfaces `rawPayload`/`rawWebhookPayload` in any UI, matching the existing "never log/expose unnecessary raw payloads" security discipline). **No manual `PAID`/`REFUNDED` transition of any kind is proposed** — every status shown is read-only, sourced from the state machine's own transitions. **The Phase 8 refund-webhook deferral is not reopened**: `REFUND_PENDING → REFUNDED` still only ever happens via `confirmRefund`, called by nothing this phase adds.

A genuinely admin-wide "list refunds across all orders" read doesn't exist today (refunds are only ever read per-attempt via `listAttemptsForOrder`'s associated `RefundRecord[]`, or implicitly via `listReconciliationFlags`'s `stuckRefundIds`). Building the refund **queue** screen therefore likely needs one small additive read (a `listRefundsForAdmin`-shaped cursor query over the `refunds` table, `payments.read`-gated) — listed in §31, not a new business capability, purely a new read.

## 15. Audit Logs

**Fully blocked on §28.2 — no read use-case, no repo query, no route exists for `audit_logs` today.** This section documents the *design* for when that gap is resolved, per the approval's explicit instruction to design the screen and separately flag the gap, not skip the section:

- **Route**: `/admin/audit`.
- **Fields**: `createdAt`, `actorId` (resolved to the actor's email/name via a join — `actor` relation already exists), `actorType`, `action`, `entityType`, `entityId`, and `beforeData`/`afterData` rendered as a collapsed JSON diff (never a raw dump of a payload known to contain secrets — since no current writer ever puts a secret into `before_data`/`after_data`, confirmed by reading every existing `auditLog.create` call site in `auth/repo.ts`/`inventory/repo.ts`/`payment/repo.ts`, this is safe as-is, but the UI should still not silently trust a future writer and should redact any key literally named `secret`/`token`/`password` defensively).
- **Filters**: `entityType`, `action`, `actorId`, date range — all directly supported by the schema's own three indexes (`(entity_type, entity_id, created_at)`, `(actor_id, created_at)`, `(action, created_at)`), so filtering is genuinely index-backed, not a full scan.
- **Pagination**: cursor (`createdAt` + `id`), matching every other admin list in this codebase — never `OFFSET`.
- **Coverage caveat, displayed in the UI itself, not just this doc**: the screen must make it visually obvious that catalog and generic order mutations are **not** represented here (§2.3) — e.g., an empty-state or info banner noting "product/category/brand changes are not yet audit-logged; order status changes are visible on each order's own history tab instead" — so an operator investigating "who changed this product's price" isn't misled into thinking the audit log is exhaustive when it structurally cannot be yet.
- **The known Phase 9 test-cleanup gap is explicitly out of scope here**: `audit_logs` rows with `entityType` `inventory_item`/`order`/`payment_attempt` are known to accumulate in *test* runs only (Phase 9's own database only, never a real deployment) because `entity_id` isn't a real FK and no Phase 5/6/8 test helper cleans them up. This is a **test-infrastructure** issue, tracked separately (§23/§29), and has zero bearing on the audit-log *viewer's* design or correctness against real production data.

## 16. Data Tables

One reusable pattern across every list screen (products, inventory, orders, refund queue, audit log): server-rendered `<Table>` (existing shadcn primitive) fed by a cursor-paginated Server Component read, a "Load more" control (matching Phase 9's own `ProductGrid`/`nextCursor` pattern exactly — not infinite scroll, not a client-side full-dataset fetch), a `<ProductFilterForm>`-shaped native `<form method="get">` for filters (zero client JS required for filtering, matching Phase 9's established precedent), and per-row actions as a `<DropdownMenu>` (view/edit/archive/etc., each item a real link or a form-backed mutation, never a client-only state change). **No bulk destructive operation is proposed** for this phase — every existing use-case operates on one entity at a time, and the approval explicitly forbids inventing bulk-destructive capability the backend doesn't already support safely. Sorting is fixed to each existing use-case's own `orderBy` (e.g., `createdAt desc` for products, `createdAt desc` for orders) — arbitrary column sorting is not proposed, since every keyset cursor is defined relative to one specific sort order, and introducing sortable columns would require the same kind of extended-cursor work Phase 9 did for `sortBy=featured` (a real, precedented, but non-trivial pattern) — left as a fast-follow, not built in the initial pass.

## 17. Forms

Every admin form reuses the module's own existing Zod schema (e.g., `createProductSchema`, `restockInventoryData`'s shape, `requestRefundSchema`) as the single source of truth — never a hand-duplicated validation rule. React Hook Form + `@hookform/resolvers/zod` is the natural fit for the more complex multi-field forms (product create/edit, variant edit) — this is a **new dependency** to add (`react-hook-form`, `@hookform/resolvers`; neither currently in `package.json`), disclosed here rather than silently added, since the approval's "existing infrastructure to preserve" list doesn't currently include a forms library and Phase 9's simpler forms (checkout address, login) used plain `<form action={...}>` + `useTransition` without needing one — the admin catalog/variant forms are meaningfully more complex (conditional fields, nested variant/image/spec sub-forms) and justify the addition, but it is called out explicitly as a new package, not assumed pre-approved. Every form handles: Zod validation errors (mapped to per-field messages), `ForbiddenError`/`UnauthorizedError` (403/401 → redirect or inline message, never a silent failure), `ConflictError` (409 — e.g., slug/SKU collision, default-variant/primary-image invariant violations — surfaced verbatim from the backend, never reworded into a false success), network errors, loading state (`useTransition`/`isPending`), success state (toast + redirect or in-place update), and destructive-action confirmation (archive product, remove image, cancel order — a confirm step before the mutating call, matching the pattern the storefront's `OrderActions` cancel button already established in Phase 9).

## 18. Error Handling

Every route/use-case error type (`ValidationError` 400, `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409) is surfaced distinctly in the UI, never collapsed into one generic "something went wrong" — matching the existing `errorResponse()`/`AppError` hierarchy exactly, no new error taxonomy introduced.

## 19. Loading / Empty States

Per-route `loading.tsx` (skeleton tables/cards matching each screen's real layout, not a generic spinner — Phase 9's own `products/loading.tsx`/`orders/loading.tsx`-style precedent) and explicit empty states ("No products match your filters," "No orders yet," "No low-stock items," "No pending refunds") rather than a blank table.

## 20. Security

- Every mutating action re-verifies authorization server-side via the existing use-case's own `requirePermission`/ownership check — the admin nav's permission-aware hiding (§8) is cosmetic only, never relied upon.
- IDOR: every detail screen (`[productId]`, `[variantId]`, `[orderId]`, `[userId]`) resolves its own record server-side and lets the underlying use-case's own guard reject an unauthorized ID — never trusts a client-supplied "this belongs to you" assumption, matching the exact pattern every prior phase's e2e IDOR tests already prove.
- CSRF: unchanged from the existing model — Server Actions get Next's built-in origin check; any plain Route Handler mutation the admin UI calls is already session-cookie-gated the same way the storefront's own mutations are (no new unauthenticated POST surface is introduced).
- No secret/credential exposure: enforced by never adding a DTO field beyond what `SafeUser`/existing safe projections already expose (§13).
- No client-authoritative business state: identical discipline to Phase 9 — every price/status/total/permission value the UI displays came from a server read; every mutation only ever sends the same narrow, already-validated fields the existing Zod schemas accept.
- Destructive-action confirmation: required before archive/cancel/refund-cancel/(future) disable-account actions (§17).
- Session revocation: force-logout is a documented gap (§28.1), not built without an explicit decision.
- Audit logging of admin actions: catalog/order mutations performed via this new UI still won't write `audit_logs` rows, for the same reason they don't today (§2.3) — this is a real, disclosed reduction in investigability for the *new* UI's own actions, not something Phase 10 silently fixes, and is called out again in §29 (risks).

## 21. Performance

To be measured at implementation time, the same way Phase 9 measured (direct Prisma query-count checks, `next build`'s `route-bundle-stats.json`, not assumed): per-screen query counts (expect 1–2 for every list/detail screen, matching Phase 9's confirmed "1 SQL statement" pattern for equivalently-shaped catalog reads), N+1 risk specifically around the customer-detail screen's order/payment history joins (§13, deferred anyway), pagination performance (keyset throughout, §16), dashboard aggregation cost (§9 — a handful of indexed `count`/`sum`/`groupBy` calls, expected cheap, to be confirmed), admin bundle size (new `react-hook-form` dependency's actual cost measured against `route-bundle-stats.json`, not assumed negligible), and large-dataset behavior for inventory/order lists at real data volumes (not measurable pre-implementation against this environment's test data — flagged as a risk, §29, not a blocker).

## 22. Accessibility

Same bar as Phase 9's storefront: semantic HTML, full keyboard navigation (data tables' row actions and filter forms must be keyboard-operable, not just mouse/touch), visible focus states (shadcn's default, not overridden), accessible dialogs (Base UI's `Dialog`/`AlertDialog`-equivalent for destructive confirmations, which already ship correct focus-trap/ARIA behavior per Phase 9's own confirmation), form errors with `aria-invalid`/`aria-describedby`, `aria-live` regions for async mutation results (toast confirmations), sufficient contrast against the existing token palette, and `prefers-reduced-motion` respected for any table/drawer transition.

## 23. Responsive Behavior

Desktop-first (this is genuinely an internal, operator-facing tool, unlike the storefront), but not desktop-only: dense tables (product list, order list, inventory list) get a horizontal-scroll container on narrow viewports rather than being force-fit into a tiny table (matching the artifact-table convention: wide content scrolls inside its own container, the page itself never scrolls horizontally); detail screens (`[orderId]`, `[productId]`, `[variantId]`) reflow to a single stacked column below `md`; the admin nav collapses to a `Sheet`-based drawer on mobile, reusing the exact `MobileNav`/`Sheet` pattern Phase 9 already built for the storefront header, not a new mechanism.

## 24. Caching

Per §16 of the approval, admin pages default to fully dynamic (`instant = false`, no `"use cache"` anywhere in `/admin/**`) — customer data, orders, payment data, inventory state, and audit logs are never cached, full stop. The Phase 9 public-catalog cache behavior (`app/_data/catalog.ts`'s `"use cache"`/`cacheTag`/`cacheLife` wrappers) is **completely unchanged** — the admin catalog screens call the underlying **admin** use-cases (`listProductsForAdmin`, `getProductForAdmin`, etc.) directly, uncached, never through the storefront's cached wrappers, so an admin always sees the true current state regardless of the public cache's freshness window. The only place this plan even discusses caching a value (§9's dashboard metrics) explicitly defaults to dynamic and only floats caching as a possible future optimization pending real measurement — nothing is cached by default.

## 25. Testing Strategy

- **Unit**: any new pure logic this phase introduces (e.g., a low-stock badge threshold comparison, a dashboard date-range-to-Prisma-filter mapper) — matching Phase 9's own "extract pure functions for testability" precedent (`derivePaymentResultState`).
- **Integration** (real MySQL, no repository mocks, matching every prior phase): the additive use-cases this plan proposes (admin category/brand `publicOnly=false` reads, order date-range/customer filter, refund-queue read, and — if approved — the customer-management gap-filling use-cases from §28.1) each get the same authorization-matrix + IDOR test treatment every existing admin use-case already has (`staff` can/cannot per the seeded permission set, `customer` always 403, ownership-vs-permission where applicable).
- **e2e** (Playwright, `request` fixture only, no browser — the established convention for six phases running): a new `tests/e2e/admin.spec.ts` covering the real HTTP contract for whichever screens ship in the initial pass — product create/edit/archive as `super_admin`, inventory restock/adjust as `staff`, order list/detail/cancel, payment refund request/cancel, and a `staff`-cannot-access-customers/audit 403 check (proving the permission-aware nav's hidden links are also server-rejected, not just hidden).

## 26. E2E Strategy

Extends `tests/e2e/admin.spec.ts` only — no existing e2e file is modified except `tests/e2e/global-teardown.ts` gaining a `Phase10E2E`-prefixed cleanup block, matching every prior phase's exact convention (product-name-prefix matching, FK-aware deletion order, plus this phase's own newly-hardened empty-guest-cart and orphan-cart sweep already covering any incidental cart creation).

## 27. Database Impact

**Zero.** No migration, no schema change, of any kind, in this plan. Every additive backend read/extension proposed (§10's admin category/brand listing, §12's order date-range/search filter, §14's refund-queue read, and the customer-management use-cases in §28.1 if approved) is new **application code** against **existing columns** — none require a new table, column, or index.

## 28. API / Backend Gaps (explicit, not silently filled)

1. **Customer management** (§13) — no `listUsers`/`listUsersForAdmin`, no `setUserStatus` (disable/enable), no admin-facing `forceLogoutUser`, no `listSessionsForUser`. The smallest of these (`forceLogoutUser`) is a thin wrapper around an already-existing repo primitive (`deleteAllSessionsForUser`); the others need new repo queries but no new columns. **Recommendation**: scope a small, explicit follow-up approval for these four before Customer Management ships beyond "view one profile + manage roles."
2. **Audit log read** — no `listAuditLogs` use-case, repo query, or route exists. **Recommendation**: a small, `users.manage`-gated, cursor-paginated read (mirrors every other admin list exactly) — no schema change, straightforward, but still a new capability requiring its own approval before `/admin/audit` can function.
3. **Order fulfillment-status transitions** (`PROCESSING → READY_FOR_DISPATCH → SHIPPED → DELIVERED`) — the state machine already defines these transitions, but **no use-case exists to trigger any of them** (only `PAY`, `CANCEL`, and the payment-driven `PAID` transition are wired to real code paths; the shipping/fulfillment side was explicitly out of scope for every phase through 9). If an operator needs to actually move an order through fulfillment from this dashboard, that's new use-case work requiring its own scoping — not built here, not invented as a generic status-PATCH endpoint.
4. **Admin category/brand `publicOnly=false` listing** — small gap, repo-layer support already exists (§10's note); just needs the admin use-case/route wiring.
5. **Order list date-range + search filters** — `listOrdersForAdmin` only filters by `status` today; date-range and order-number/customer-email search are additive extensions in the same shape Phase 9 added to `listProducts` (§9 of that plan), not built yet.
6. **Refund-queue-wide read** — refunds are only readable per-attempt today; an admin-wide "all refunds" cursor query is a small additive read, not yet built.

None of these are implemented by this planning document. Each requires its own explicit go-ahead before the corresponding screen can be built as designed.

## 29. Risks

1. **Customer Management is the single biggest scope risk** — the approval's evaluation list (§9 of the approval) assumes considerably more backend capability than actually exists. Mitigation: ship the reduced initial scope (§13) and treat §28.1 as a distinct, explicitly-approved follow-up rather than blocking all of Phase 10 on it.
2. **The audit log's structural incompleteness (§2.3/§15) could mislead an operator** into thinking "nothing happened" to a product when in fact the product was edited and simply isn't logged. Mitigation: the UI-level coverage caveat in §15 is load-bearing, not decorative — it must ship with the screen, not as an afterthought.
3. **`react-hook-form` is a new dependency** (§17) — a real, if small, addition to "existing infrastructure to preserve." Mitigation: disclosed explicitly here; if rejected at approval time, the more complex catalog forms fall back to the plain `<form action=...>` + `useTransition` pattern Phase 9 already used successfully, at some cost to nested-field ergonomics.
4. **Large-dataset performance for inventory/order lists is unmeasured** (§21) — this environment's test data volume won't reveal a real-scale slow query. Mitigation: keyset pagination (already the universal convention) bounds the worst case regardless of table size; a real measurement pass is still recommended once real data volume exists.
5. **Permission-aware nav could be mistaken for the security boundary** by a future contributor unfamiliar with this codebase's discipline. Mitigation: every screen's own doc comment (matching every existing use-case's own convention) states its real enforcement point explicitly, and the e2e suite (§25) proves hidden-link targets 403 for `staff`/`customer` directly.

## 30. Open Questions

1. Should `/admin/audit` be gated by `users.manage` (this plan's recommendation, §7) or should a narrower approach be considered — e.g., not shipping it in Phase 10's initial pass at all, given it's fully blocked on a new backend read (§28.2)?
2. Is an "inventory value" dashboard metric wanted badly enough to justify adding a `cost_price`-type column (a real, if small, schema change) in a future phase, or should it stay permanently out of scope as unrepresentable with current data?
3. What is the actual desired initial scope for Customer Management — ship only "view profile + manage roles" now, or treat §28.1's gaps as a prerequisite mini-phase before any Customer Management screen ships at all?
4. Is `react-hook-form` an acceptable new dependency, or should every admin form use the plain `<form action>` + `useTransition` pattern instead (more verbose for nested variant/image sub-forms, but zero new dependencies)?
5. Should `/admin` (the bare dashboard route) or `/admin/orders` be the actual landing page after login for staff/admin? (A UX decision, not an architectural one — noted so it isn't silently decided during implementation.)

## 31. Implementation Sequence (proposed, for the eventual implementation-approval message — not started here)

1. Admin shell: `app/admin/layout.tsx`, `AdminNav`, permission-aware section visibility — the smallest possible slice needed to prove the pattern once (mirrors Phase 9's own sequencing discipline: establish one pattern on a small surface before repeating it).
2. Dashboard (§9) — read-only, no mutations, lowest risk, immediately useful.
3. Order management (§12) — fullest existing backend support of any area (list, detail, cancel, retry, payment-attempt visibility all already exist); date-range/search filter as a small additive extension alongside it.
4. Inventory management (§11) — second-fullest existing backend support (overview, detail, restock/adjust/return, low-stock filter all exist already).
5. Payment visibility (§14) — reconciliation overview first (zero new reads needed); refund queue second (needs the one additive admin-wide read, §28.6).
6. Catalog management (§10) — the most form-heavy area (product create/edit, variant/image/spec sub-forms) — sequenced after the simpler read-heavy screens so the `react-hook-form` question (§30 Q4) is resolved with real screens already shipped to compare against.
7. **Decision checkpoint**: resolve §28.1 (customer-management gaps) and §28.2 (audit-log read) before building Customer Management or Audit Logs beyond the already-supported "view profile + manage roles" slice.
8. Customer Management (reduced scope, §13) and/or Audit Logs (§15), once §28.1/§28.2 are explicitly approved.
9. Full test suite (§25) + e2e (§26) + performance verification (§21) + final regression check against Phases 3–9's own suites.

## 32. Definition of Done

For whatever slice of this plan is actually approved for implementation: every screen's stated permission boundary is enforced server-side (proven by an e2e 403 test, not just a hidden nav item); every mutation goes through an existing or newly-and-explicitly-approved use-case, never a generic escape-hatch endpoint; zero schema migrations; zero new permissions; TypeScript/ESLint/Prettier clean; the full pre-existing Phase 3–9 test suite passes unmodified; new tests exist for every new use-case/route at the same authorization-matrix depth every prior phase established; production build exits 0; a direct database-cleanliness check (not test-framework self-reporting) shows zero leftover test data; the implementation report discloses every deviation, every discovered bug, and every remaining backend gap — exactly as every prior phase's report has.

## 33. Hard-Stop Conditions

Per the approval's own §20/§26, re-evaluated against everything grounded above:

- ✅ No database migration is required for anything in this plan's in-scope, backend-gap-free work — no stop.
- ⚠️ **Customer Management and Audit Logs cannot be fully built without new backend capability** (§28.1, §28.2) — not a stop on producing this plan, but a hard stop on building either screen beyond its already-supported slice until that capability is explicitly approved, per the approval's own instruction not to silently create new mutations/reads without disclosure.
- ✅ No existing Phase 3–9 behavior needs to change for any screen in this plan — every admin screen is a new, additive consumer of already-existing, already-tested use-cases.
- ✅ Refund-webhook processing remains deferred and is not reopened anywhere in this plan.
- ✅ The Phase 9 audit-log test-cleanup gap remains a separately-tracked, unfixed, out-of-scope technical-debt item (§23), not silently resolved here.
- ✅ This plan does not expand into ERP/CRM/accounting/shipping/warehouse management — every §22 exclusion was checked against the actual section list above and none were crossed.

**Net result: this plan does not need to stop before proceeding to an implementation-approval request.** It surfaces two genuine, load-bearing backend-capability gaps (Customer Management, Audit Logs) and five open questions that should be explicitly resolved — via approval, not silent assumption — before the specific pieces of implementation that depend on them begin. Every other screen (Dashboard, Catalog, Inventory, Orders, Payments' read/reconciliation/refund surfaces) is fully supported by the existing, verified backend and ready to build once this plan itself is approved.

---

**PHASE 10 PLAN COMPLETE — AWAITING APPROVAL**

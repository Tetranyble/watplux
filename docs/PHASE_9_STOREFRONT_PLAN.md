# Phase 9 — Storefront / Customer Shopping Experience: Architecture & Implementation Plan

**Status: PLANNING ONLY. No application code, migration, repository, use-case, route, component, page, or test was written to produce this document.**

Every claim below was verified against the actual repository (`prisma/schema.prisma`, `src/modules/**`, `app/**`, `next.config.ts`, `components.json`, `package.json`) as it exists today, not against `docs/ARCHITECTURE.md`/`docs/DATABASE_DESIGN.md` alone. Every place the code has diverged from those Phase 0 documents is called out explicitly in §2.

---

## 1. Executive Summary

Phase 9 builds the customer-facing storefront — browsing, search/filter, product detail, cart, checkout, Paystack payment return, and order history — entirely as a **consumer** of the Catalog, Inventory, Cart, Checkout, Order, Payment, and Auth/RBAC modules built in Phases 3–8. It introduces **zero database migrations** and touches **zero payment/refund business logic**.

The single most consequential finding from grounding this plan in the real code (§3.6, §13, §29) is: **a guest (no account) checkout customer has no authenticated way to read their own order/payment status after being redirected back from Paystack**, because every existing order/payment read route requires a session (`requireSessionUser()`) and guest orders have `userId = null`, so no ownership check can ever pass for them. This is a genuine, pre-existing backend gap (not something Phase 7/8 broke — it was simply never exercised by a browser before). §13.4 and §29 present three resolution options with a recommendation; **implementation of whichever option is chosen requires its own explicit approval before any backend code is touched**, per this plan's own hard-stop discipline (§33).

Everything else the storefront needs — public catalog reads, cart mutations, checkout submission, the Paystack redirect URL, authenticated order/payment reads, IDOR protection — already exists and is sufficient as-is. A handful of small, additive, non-breaking backend reads are still needed (category/brand-by-slug lookups, listing-filter extensions) and are listed precisely in §31; none require a schema change.

## 2. Grounded Current Architecture (code as of this writing, not stale docs)

### 2.1 Module inventory
`src/modules/` contains exactly: `auth`, `cart`, `catalog`, `checkout`, `health`, `inventory`, `order`, `payment`. There is **no** `service`/`consultation`/`review`/`settings`/`coupon` module, despite matching Prisma models existing (§2.4).

### 2.2 App shell — genuinely minimal today
- `app/layout.tsx` is still the unmodified `create-next-app` scaffold (generic metadata, no nav/footer/header).
- `app/page.tsx` is still the unmodified Next.js/Vercel starter homepage.
- `app/globals.css` is Tailwind v4 CSS-config style (`@import "tailwindcss"`, `@theme inline {...}`), already shadcn-flavored.
- `components.json` confirms shadcn/ui is initialized: `style: "base-nova"`, `baseColor: "neutral"`, `cssVariables: true`, icon library `lucide`. Only **one** component exists: `components/ui/button.tsx`.
- `app/login/**` and `app/account/**` are real, working, but explicitly unstyled (code comments: *"Not styled — storefront/account UI polish is Phase 6, not Phase 3"* — that phase-numbering reference is itself stale; account/login styling is now Phase 9 work). No register/password-reset/email-verification UI pages exist (API-only).
- `proxy.ts` protects `/account/:path*` and `/admin/:path*` with a cheap cookie-presence check, redirecting to `/login?next=<path>`; it does **not** validate the session — that happens per-page via `getSessionUser()`/`requireSessionUser()`.
- No `sitemap.ts`, `robots.ts`, or `generateMetadata` call exists anywhere in the repo yet.

### 2.3 Cache Components — enabled, unused
`next.config.ts` sets `cacheComponents: true`. Grepping the entire repo for `"use cache"`, `cacheLife(`, `cacheTag(`, `revalidateTag(` returns **zero matches** — the flag is on, but nothing uses it yet. Phase 9 is the first phase that will.

### 2.4 Divergences from `docs/ARCHITECTURE.md` / `docs/DATABASE_DESIGN.md`

| Doc claim | Actual code | Divergence |
|---|---|---|
| §20 "MySQL-first search" (full-text + indexes, no Elasticsearch) | `catalog/repo.ts`'s `listProducts` search filter is `name: { contains: search }` — a plain unindexed `LIKE '%...%'` on `name` only. No `@@fulltext` index anywhere in the schema; `description` isn't searched at all. | The "MySQL full-text" half of the stated strategy was never built. Current reality is weaker than documented. §9 addresses this without proposing Elasticsearch, per instruction. |
| §12 Caching Strategy (`use cache`/`cacheTag`/`updateTag` on product/category reads) | Not implemented anywhere — no rendering layer exists yet to apply it to. | Not a contradiction, just not-yet-built; Phase 9 is where it gets built (§8). |
| §14 SEO Strategy (`generateMetadata`, `Product`/`BreadcrumbList` JSON-LD, `sitemap.ts`, `robots.ts`) | None of these exist. `Product`/`Category` do already have `seoTitle`/`seoDescription` columns and unique slugs ready for it. | Data is SEO-ready; delivery mechanism is unbuilt. Phase 9 builds it (§17). |
| §19 risk #6: "Refund webhook event names/payload shape... needs confirming before Phase 9/10 implements refund processing" | Phase 8 already ran this verification, found the gap, and the user explicitly approved deferring refund-webhook processing (documented in `docs/PHASE_8_PAYMENT_PAYSTACK_IMPLEMENTATION.md` §1, §18) and **explicitly instructed no further work on it**. | The Phase 0 doc's phase numbering ("Phase 9/10") for refund work is stale — Phase 9 is Storefront, not refund processing, and refund architecture is out of scope for this phase entirely (§32). |
| §13 Image/Media Strategy (object storage + CDN, `product_images` real table, no polymorphic media table) | Matches exactly. `ProductImage` model is exactly as documented; `Brand.logoUrl`/`Category.imageUrl` are plain nullable columns. | No divergence. |
| §16 Testing Strategy (Playwright guest checkout happy path) | Matches the established e2e convention from Phases 3–8 (`request`-fixture-only, no browser). | No divergence — Phase 9 e2e follows the same convention (§24). |

### 2.5 Schema-only domains — confirmed unimplemented
`ServiceRequest`, `Review`, `Coupon`/`CouponRedemption`, `Settings`/`SettingEntry` all exist as full Prisma models but have **zero** consuming code (`src/modules/`, `app/`) anywhere in the repo — no repo, no use-case, no route. The RBAC permission keys `consultations.read`/`consultations.update` are seeded (assigned to `staff`) but nothing checks them. This directly shapes §16 (Consultation/Installation) and the out-of-scope list (§32).

## 3. Existing Backend Contracts (what Phase 9 can call as-is, verbatim)

### 3.1 Catalog (public reads — no auth)
- `getProductBySlug(slug: string): Promise<ProductDetail>` — public visibility = `Product.status: "ACTIVE" AND deletedAt: null`, variants additionally filtered `status: "ACTIVE"`.
- `listProducts(input: ListProductsInput): Promise<CursorPage<ProductSummary>>` — filters today: `categoryId?, brandId?, featured?: boolean, search?: string`. Cursor = base64url(`createdAt|id`), `DEFAULT_PAGE_SIZE=20`, `MAX_PAGE_SIZE=100`.
- `getCategoryTree(): Promise<CategoryTreeNode[]>` — full nested tree, no pagination, no by-slug lookup.
- `listBrands(): Promise<CatalogBrand[]>` — full flat list, no pagination, no by-slug lookup.

`ProductSummary` (card shape): id, name, slug, status, isFeatured, brand summary, category summary, **one** primary image (`url`, `altText`), **one** default variant (`id, sku, priceMinor, compareAtPriceMinor, currency`), createdAt.

`ProductDetail` (PDP shape): everything above plus `shortDescription, description, unitOfMeasure, warrantyMonths, seoTitle, seoDescription`, **all** variants (`CatalogVariant[]` — id, sku, variantLabel, optionValues, isDefault, status, sortOrder, priceMinor, compareAtPriceMinor, currency, powerRatingW, voltageV, capacityWh, ratedCurrentA, phase, efficiencyPercent, mpptMinV, mpptMaxV, weightKg, lengthCm, widthCm, heightCm), all images (`CatalogImage[]` — url, altText, width, height, isPrimary, sortOrder), all specifications (`CatalogSpecification[]` — specKey, specValue, unit, groupLabel, sortOrder).

Money is always `priceMinor`/`compareAtPriceMinor` (integer minor units), never a float — the storefront must format, never compute, price display.

### 3.2 Inventory (public read — no auth, exactly one function)
- `getAvailableQuantity(variantId: bigint): Promise<number>` — explicitly documented "no actor, no permission check... deliberately returns only `quantityAvailable`... returns `0` for a variant with no `InventoryItem` row yet." **Non-authoritative** — the real stock gate is checkout's own guarded UPDATE. Not currently joined into any catalog read; must be called separately per variant.

### 3.3 Cart (client-facing, cookie-identified)
- `POST /api/cart/items` `{variantId, quantity}` → `201 {cart}` — the only route that lazily issues a guest cookie (`guest_cart_token`, 30-day TTL, httpOnly/secure-in-prod/sameSite=lax).
- `PATCH /api/cart/items/[itemId]` `{quantity}` → `{cart}`; `DELETE /api/cart/items/[itemId]` → `{cart}`.
- `GET /api/cart` → `{cart: CartDetail | null}` (never creates); `DELETE /api/cart` → clears.
- `GET /api/cart/count` → `{count}`.
- `CartDetail`: id, status, itemCount, items (`CartItemRecord[]`: productVariantId, productName, sku, variantLabel, isVariantActive, quantity, `priceSnapshotMinor` — display-only, refreshed server-side on every mutation, never client-trusted — `lineDisplayTotalMinor`), `subtotalDisplayMinor` (display-only; checkout never reads it).
- Client submits **only** `variantId` + `quantity`, ever. No inventory reservation happens on add-to-cart (confirmed by code comment and integration test — reservation only exists after `completeCheckout`).
- Guest→user merge happens automatically inside the existing `login()` use-case — the storefront's login form just needs to forward the guest cookie's raw token (already read server-side by the login Server Action; no client wiring needed beyond a normal login form POST).

### 3.4 Checkout
- `GET /api/checkout/validate` → `{report: CheckoutValidationReport}` (`isValid`, per-line `hasSufficientStock`/`issue` — **non-authoritative preview only**, explicitly documented: *"the real gate is the guarded UPDATE inside reserveInventoryForNewOrderItem, evaluated only at completeCheckout time."*)
- `POST /api/checkout` `{shippingAddress, billingAddress?, customerNote?, guestEmail?, guestPhone?}` → `201 {order: OrderDetail, payment: InitializePaymentResult}`. Guest checkout requires `guestEmail`. **No `cartId` field** — cart identity is always server-resolved. Address shape: `fullName, phone, addressLine1, addressLine2?, city, state, country(default "NG"), postalCode?, deliveryNotes?`.
- `InitializePaymentResult` (exact discriminated union, used identically by checkout and retry):
  ```ts
  { outcome: "PENDING"; authorizationUrl: string; accessCode: string }
  | { outcome: "INITIALIZATION_FAILED"; errorCode: string; errorMessage: string }
  ```
  **The storefront's entire "redirect to Paystack" logic is: if `payment.outcome === "PENDING"`, `window.location.href = payment.authorizationUrl`.** HTTP status is always `201` even when `payment.outcome === "INITIALIZATION_FAILED"` (the order was still created) — the frontend must branch on `payment.outcome`, never on HTTP status, to decide the next screen.

### 3.5 Order + Payment reads (authenticated only — see §3.6 for the guest gap)
- `GET /api/orders` (list mine), `GET /api/orders/[orderId]`, `GET /api/orders/by-number/[orderNumber]` (authenticated-only, no guest path), `POST /api/orders/[orderId]/cancel`, `GET /api/orders/[orderId]/payment-attempts`, `POST /api/orders/[orderId]/retry-payment`.
- Every one of these calls `requireSessionUser()` first (throws `401` with **no session at all**), then applies the identical ownership-or-elevated-permission pattern verbatim across `get-order-by-id.ts`, `get-order-by-order-number.ts`, `cancel-order.ts`, `list-payment-attempts-for-order.ts`, `retry-payment.ts`:
  ```ts
  const isOwner = order.userId !== null && order.userId === actor.id;
  const canReadAnyOrder = actor.permissions.has(PERMISSION_ORDERS_READ); // or payments.read / orders.update
  if (!isOwner && !canReadAnyOrder) throw new ForbiddenError(...);
  ```
- **There is no dedicated "get payment status by reference" endpoint.** The only authoritative read path is `GET /api/orders/[orderId]/payment-attempts`, returning `PaymentAttemptRecord[]` (status: `INITIATED|PENDING|SUCCESS|FAILED|ABANDONED|INITIALIZATION_FAILED`).
- Order state machine: `PENDING_PAYMENT → PAID → PROCESSING → READY_FOR_DISPATCH → SHIPPED → DELIVERED`, with `CANCEL` from `PENDING_PAYMENT`/`PAID` and `REFUND` from any of `PAID..DELIVERED`; `CANCELLED`/`REFUNDED` terminal. `PENDING_PAYMENT → CANCEL` is customer-cancellable; every later state requires `orders.update`.

### 3.6 The guest-checkout authentication gap (headline finding — see §13.4, §29)
Because `isOwner` is only ever true when `order.userId === actor.id`, and a guest order's `userId` is `null`, **no actor can ever satisfy `isOwner` for a guest order** — and `requireSessionUser()` rejects the request before that check is even reached if there's no session cookie at all. A guest who completes checkout and gets redirected to Paystack has no existing, authenticated way to poll their own order/payment status on return. This must be resolved (an explicit decision, not a workaround) before the Payment-Return UX (§13) can be fully built for guests.

### 3.7 Auth/session mechanics the storefront must reuse exactly
- Session cookie: `"session"`, httpOnly, secure-in-production, sameSite=lax. `getSessionUser()` (`lib/session.ts`) is wrapped in React's `cache()` — safe to call from multiple Server Components in one request tree with only one DB round-trip.
- `requirePermission(actor, key)` / `hasPermission(actor, key)` are the **only** sanctioned authorization checks — the storefront must never invent a `user.role === "..."` string comparison.
- No client-side auth state library exists or is needed — every protected page re-derives its own auth state server-side per request.

## 4. Route Architecture

No route groups are introduced — `app/account/**`/`app/login/**` stay exactly where they are (a route-group refactor of already-working code buys nothing here and risks an unnecessary regression). New top-level routes:

```
app/
  page.tsx                              — replaces the Next.js starter homepage
  products/
    page.tsx                            — listing (category/brand/search/filter/sort via searchParams)
    [slug]/
      page.tsx                          — PDP
      loading.tsx / not-found.tsx
  categories/
    [slug]/page.tsx                     — category landing (needs a new by-slug read, §31)
  brands/
    [slug]/page.tsx                     — brand landing (needs a new by-slug read, §31)
  cart/
    page.tsx                            — full cart page (mobile-first; a drawer is a client-side enhancement of the same data, not a second data source)
  checkout/
    page.tsx                            — address/contact form, submits to POST /api/checkout
    payment-result/
      page.tsx                          — Paystack return landing (§13)
  consultation/
    page.tsx                            — entry point; see §16 for why this may be a static contact CTA in Phase 9
  installation/
    page.tsx                            — same
  account/
    orders/
      page.tsx                          — NEW: customer order list (extends existing app/account/**)
      [orderId]/page.tsx                — NEW: order detail
  sitemap.ts                            — NEW
  robots.ts                             — NEW
  layout.tsx                            — MODIFIED: real nav/footer shell
  page.tsx                              — MODIFIED: replaced starter content
  globals.css                           — MODIFIED only if new design tokens are needed
```

Every page above is a **Server Component by default**. Client Components are isolated leaves: add-to-cart button, quantity stepper, filter widgets, mobile nav toggle, image gallery thumbnail selector, cart-drawer trigger, payment-result polling widget (§13.3).

## 5. Page / Screen Map

| Screen | Route | Server/Client | Auth |
|---|---|---|---|
| Home | `/` | Server | Public |
| Product listing | `/products` | Server (filters via `searchParams`) | Public |
| Category landing | `/categories/[slug]` | Server | Public |
| Brand landing | `/brands/[slug]` | Server | Public |
| Product detail | `/products/[slug]` | Server + client leaves | Public |
| Cart | `/cart` | Server (data) + client (mutations) | Public (guest or session) |
| Checkout | `/checkout` | Server shell + client form | Public (guest or session) |
| Payment result | `/checkout/payment-result` | Server (initial read) + client (poll, §13.3) | Public (guest or session — see §13.4) |
| Order list | `/account/orders` | Server | Session required (proxy.ts already covers `/account/*`) |
| Order detail | `/account/orders/[orderId]` | Server | Session required |
| Consultation | `/consultation` | Server (static form → mailto or a minimal capture, §16) | Public |
| Installation | `/installation` | Server, same as above | Public |
| Login | `/login` | Existing, restyled | Public |
| Account home | `/account` | Existing, restyled | Session required |

## 6. Component Architecture

Built on the existing shadcn `base-nova` install (`components.json`, `neutral` base color, CSS variables, `lucide` icons). Only `Button` exists today — everything else is net-new shadcn primitives added via the shadcn CLI (not hand-rolled), consistent with "do not install another UI framework":

- **Primitives to add** (via `npx shadcn add`, not authored from scratch): `card`, `badge`, `input`, `select`, `checkbox`, `dialog`, `sheet` (cart drawer, mobile filters), `dropdown-menu`, `table` (order history), `skeleton`, `alert`, `sonner`/`toast`, `separator`, `tabs` (PDP spec groups), `breadcrumb`.
- **Storefront-specific composed components** (`components/storefront/`): `ProductCard`, `ProductGrid`, `ProductGallery` (client, thumbnail selection), `PriceDisplay` (formats `priceMinor`/`compareAtPriceMinor` — the **one** place minor-unit formatting logic lives, mirroring the backend's "one mapping point" discipline), `StockBadge` (reads `getAvailableQuantity`, client-safe wrapper), `FilterSidebar`/`FilterSheet` (client, writes `searchParams`), `SortSelect` (client), `QuantitySelector` (client), `AddToCartButton` (client, calls `POST /api/cart/items`), `CartLineItem`, `CartSummary`, `CartDrawer` (client, `sheet`-based), `CheckoutAddressForm` (client, Server-Action-backed), `PaymentResultPanel` (client, polling — §13.3), `OrderStatusBadge`, `OrderList`, `OrderDetailPanel`, `SpecTable` (renders both the typed solar-facet columns and the EAV `ProductSpecification[]` rows under one UI, §7 of the approval message), `Breadcrumbs`, `SiteHeader`/`SiteFooter`/`MobileNav`.
- No component reaches into Prisma or a repo directly — every component receives already-shaped data (`ProductSummary`, `CartDetail`, etc.) as props, matching the existing module boundary discipline.

## 7. Data-Fetching Architecture

Per the approval message's explicit preference (§20): **Server Component → Use Case → Repository directly**, never a Server Component `fetch()`-ing this app's own `/api/**` route. This is safe here because every public catalog use-case already takes no `actor`/no request object — it's a plain async function callable from anywhere in the Node process.

- **Public, server-rendered pages** (`/`, `/products`, `/products/[slug]`, `/categories/[slug]`, `/brands/[slug]`): call `listProducts`/`getProductBySlug`/`getCategoryTree`/`listBrands` (plus the two new by-slug use-cases, §31) directly from the Server Component (or a thin server-only data-loader module colocated under the page, e.g. `app/products/[slug]/data.ts`, so the "use cache" boundary in §8 has a stable place to live).
- **Client-driven mutations** (cart add/update/remove, checkout submit, login, retry payment): the browser calls the existing `/api/**` routes exactly as they are today — no new API surface for these, no bypassing Zod validation client-side.
- **Account/order pages**: Server Component calls `getSessionUser()` (already `cache()`-wrapped) then the order/payment use-cases directly — the exact pattern `app/account/page.tsx` already establishes.
- **Never**: a Server Component issuing `fetch("/api/...")` against its own deployment — this doubles latency (extra HTTP round-trip + re-serialization) for zero benefit when the use-case is already a plain function call away, and the approval message explicitly forbids it.

## 8. Cache Components Strategy

`cacheComponents: true` is already on; nothing in the codebase uses `"use cache"` yet, so Phase 9 establishes the pattern from scratch, directly against the code found in §7 — not the aspirational `docs/ARCHITECTURE.md` §12 text, though the two land on the same design:

| Data | Directive | `cacheTag` | `cacheLife` | Invalidated by |
|---|---|---|---|---|
| `getCategoryTree()` | `"use cache"` | `catalog:categories` | `hours` | `createCategory`/`updateCategory`/`setCategoryActive`/`reorderCategories` |
| `listBrands()` | `"use cache"` | `catalog:brands` | `hours` | `createBrand`/`updateBrand`/`setBrandActive` |
| `listProducts(filters)` | `"use cache"`, tag includes a filter-shape-independent coarse tag (not per-filter-combination, to keep invalidation tractable) | `catalog:products` | `minutes` (short — listings must reflect a new/archived product reasonably fast) | any product/variant/image mutation (see mapping below) |
| `getProductBySlug(slug)` | `"use cache"` | `catalog:product:{slug}` **and** `catalog:products` (so it's also swept by a coarse listing-level bust if ever needed) | `hours` | that product's own mutations |
| `getAvailableQuantity(variantId)` | **No caching** — always dynamic, read fresh per request, wrapped in its own `<Suspense>` inside an otherwise-cached PDP/card shell | — | — | N/A (changes too fast to cache safely; non-authoritative anyway) |
| Cart, checkout, payment-result, account/orders | **No caching anywhere** — session/cookie-derived, per the approval message's explicit rule and the existing `app/account/page.tsx` precedent (`export const instant = false` there is the same idea) | — | — | N/A |

**Invalidation call sites** (additive `revalidateTag`/`updateTag` calls added to existing catalog use-cases — no schema change, small surgical additions, listed precisely in §31):
```
createProduct / updateProduct / publishProduct / archiveProduct / softDeleteProduct / restoreProduct
  → revalidateTag("catalog:products"), revalidateTag(`catalog:product:${slug}`)
createVariant / updateVariant / archiveVariant / reactivateVariant / setDefaultVariant / reorderVariants
  → revalidateTag(`catalog:product:${parentProductSlug}`), revalidateTag("catalog:products")  // price/spec changes ripple to listings too
addProductImage / updateProductImage / setPrimaryImage / removeProductImage / reorderProductImages
  → revalidateTag(`catalog:product:${parentProductSlug}`)
upsertProductSpecification / removeProductSpecification
  → revalidateTag(`catalog:product:${parentProductSlug}`)
createCategory / updateCategory / setCategoryActive / reorderCategories
  → revalidateTag("catalog:categories"), revalidateTag("catalog:products")  // category rename can affect listing breadcrumbs/filters
createBrand / updateBrand / setBrandActive
  → revalidateTag("catalog:brands"), revalidateTag("catalog:products")
```
This mapping directly answers the approval message's §19 example table ("product updated → invalidate product + relevant listings," etc.) using the actual use-case names that exist today — no blind full-storefront invalidation.

## 9. Catalog / Search UX

Filters supported **today** by `ListProductsFilters`: `categoryId, brandId, featured, search (name-only LIKE)`. Phase 9 additively extends this (new optional fields on `listProductsSchema`/`ListProductsFilters`/`listProductsPublic` — no schema change, §31):

- **In scope for Phase 9**: category, brand, featured, search (unchanged mechanism — see limitation below), price range (`minPriceMinor`/`maxPriceMinor` against the joined default-variant price), solar facets (`powerRatingWMin/Max`, `voltageV`, `phase`) filtered via `variants: { some: { status: "ACTIVE", ... } }`, sort by `newest` (default, existing cursor) or `featured` (isFeatured desc, then createdAt desc — same cursor shape, just a different `orderBy`), cursor pagination unchanged (`hasNextPage` via `take: limit + 1`).
- **Explicitly deferred, not silently added** (each is a real design decision, not an oversight):
  - **Price-sort** (`price_asc`/`price_desc`): requires a *different* keyset cursor shape (`(priceMinor, id)` instead of `(createdAt, id)`), and the cursor would need to self-describe which shape it encodes so `decodeProductCursor` doesn't misparse a `newest`-cursor as a `price`-cursor mid-pagination. Real, bounded work — sequenced as a fast-follow, not blocking Phase 9's initial ship (§30).
  - **"In stock only" as a true listing filter**: would require either a raw cross-module join (`product_variants → inventory_items`) inside `catalog/repo.ts`, which no existing catalog code does today (catalog has zero inventory references, confirmed by grep), or an app-level post-filter that breaks cursor-page-size guarantees. Flagged as an **open question** (§28) needing an explicit architecture decision — not resolved by this plan unilaterally, since it crosses a module boundary no prior phase has crossed at the repo layer.
  - A dedicated `findCategoryBySlugPublic`/`findBrandBySlugPublic` read (currently missing entirely — only `listProductsPublic({categoryId/brandId})` by numeric ID exists) is required for `/categories/[slug]` and `/brands/[slug]` to resolve their own landing page data; this is additive, no schema change (both `slug` columns are already `@unique`), listed in §31.
- **Search**: stays MySQL `LIKE`-based for this phase, per the explicit instruction not to introduce Elasticsearch/OpenSearch/Algolia/Meilisearch without evidence of need. Documented, disclosed limitation carried forward from §2.4: no ranking, no `description` search, degrades at scale. **Recommended future optimization** (not Phase 9 scope, would need its own approval since it's a schema change): a MySQL `@@fulltext` index on `(name, description)` with `MATCH...AGAINST` — this is exactly the "MySQL-first" strategy the Phase 0 doc already committed to; Phase 9 just doesn't build it yet.

## 10. Product-Detail Architecture

PDP (`/products/[slug]`) renders directly from `ProductDetail` (§3.1) — no additional queries needed for name/brand/images/variants/specs/price. Layout:
- Image gallery (client component for thumbnail/selection state) fed by `CatalogImage[]`, primary image LCP-priority-loaded (§18).
- Variant selector (if >1 active variant) — client component, re-renders `PriceDisplay`/`QuantitySelector`/stock badge on selection change; never re-fetches the whole PDP, just switches which already-loaded `CatalogVariant` object is active.
- `PriceDisplay` — `priceMinor`/`compareAtPriceMinor`/`currency`, computed client-side purely for display (percentage-off badge), never sent back to the server.
- Solar spec section: `SpecTable` renders the 8 typed facet columns (power/voltage/capacity/current/phase/efficiency/MPPT range) that are present (non-null) on the selected variant, grouped visually apart from the generic `ProductSpecification[]` EAV rows (grouped by `groupLabel`, ordered by `sortOrder`) — one component, two data sources, per §4/§5 of the approval message ("do not create a second solar-specification model").
- `StockBadge` — the one genuinely dynamic slice, wrapped in its own `<Suspense>` boundary per §8, calling `getAvailableQuantity(variantId)` fresh every request; falls back to a neutral "Check availability" skeleton while streaming.
- `AddToCartButton` (client) posts to `POST /api/cart/items` with `{variantId, quantity}` — never sends price.
- Consultation/Installation CTA — a static link/button to `/consultation`/`/installation` (§16), not inline logic.
- Related products — a second `listProducts({categoryId, limit: N})` call, cached per §8.
- `generateMetadata` sourced from `ProductDetail.seoTitle`/`seoDescription`/`name`/`shortDescription` (§17).

Price and availability shown are **never** re-derived by the client, and quantity/variant selection never mutates anything server-side until "Add to cart" is pressed.

## 11. Cart UX

Single source of truth: `GET /api/cart` / the mutation routes (§3.3) — no parallel client-side cart store. A `CartDrawer` (client, shadcn `sheet`) and the full `/cart` page render the **same** `CartDetail` shape; the drawer is a presentation choice, not a second cart implementation.

- Add/update/remove call the existing routes directly; on success, re-render from the route's own returned `cart` (no separate re-fetch needed — the mutation response already carries the full updated `CartDetail`).
- Guest and authenticated carts are handled identically from the frontend's perspective — `resolveCartActor()`/`resolveOrCreateCartOwner()` already abstract this server-side; the frontend never needs to know or branch on which one is active.
- Cart merge on login is automatic (already wired into `login()`); the frontend's only job is a normal login form submission — no explicit "merge my cart" UI/step is needed or should be invented.
- `hasSufficientStock`/`isVariantActive` per-line flags from `GET /api/checkout/validate` (called when entering `/cart` or `/checkout`, not on every keystroke) surface "only 2 left" / "no longer available" banners — explicitly labeled non-authoritative in the UI copy, since checkout itself is the real gate.
- **No client-side inventory reservation of any kind** — reinforcing §6 of the approval message; the cart page must never imply a hold has been placed until checkout actually completes.

## 12. Checkout UX

```
Cart page → "Checkout" CTA
  ↓
/checkout — address form (+ guestEmail/guestPhone if no session)
  ↓ POST /api/checkout
Order created (always, even if payment init fails) + payment attempt created
  ↓
payment.outcome === "PENDING"          → redirect browser to payment.authorizationUrl (Paystack-hosted)
payment.outcome === "INITIALIZATION_FAILED" → stay in-app, show retry option (§13.2)
  ↓ (Paystack hosted checkout, entirely off our domain)
Paystack redirects back to our /checkout/payment-result?... (§13)
```

- The address form is a single Zod-validated shape (`addressInputSchema`, §3.4) reused for both shipping and an optional separate billing address — client-side validation is the *same* schema imported into the form (never hand-duplicated), matching the existing codebase convention (Zod schemas are already shared between route validation and, per `docs/ARCHITECTURE.md` §17, form validation).
- The checkout Server Action (or a thin client `fetch` to `POST /api/checkout` — either is architecturally fine here since this is a genuine client-interaction endpoint, not a server-rendered read; recommendation: a Server Action wrapping the same use-case-level call is slightly more idiomatic for Next 16 forms and avoids a second HTTP hop, but either is acceptable — left as an implementation-time choice, not re-litigated here) never accepts price/subtotal/total/discount/tax/product-name/SKU fields from the client, matching the existing route's own doc comment verbatim.
- No payment processing logic — no card form, no Paystack SDK — ever runs in this app's own React tree. The only Paystack-facing action the browser takes is a full-page redirect to `authorizationUrl`, which is itself Paystack's hosted, PCI-scoped page.
- No Paystack secret key is ever referenced by any client bundle — only the public checkout page (Paystack's own domain) ever sees payment details.

## 13. Payment-Return UX

### 13.1 What Paystack's redirect actually gives us
Paystack redirects the browser back to a callback URL (configured at Initialize-Transaction time — not currently set explicitly anywhere in `src/integrations/paystack/client.ts`'s `initializeTransaction` call; **this needs a `callback_url` parameter pointing at `/checkout/payment-result` added to that call — additive, no interface change, listed in §31**) with Paystack's own query parameters (typically `?reference=...&trxref=...`). This redirect is **never trusted as proof of payment** — it only tells the frontend which order/reference to go check authoritatively.

### 13.2 Required states (`/checkout/payment-result`)
| State | Trigger | UI |
|---|---|---|
| Successful payment | `GET .../payment-attempts` shows the reference's attempt at `SUCCESS` | Order confirmation, link to order detail (if authenticated) |
| Failed payment | Attempt at `FAILED` | "Payment failed" + retry CTA (§below) |
| Pending / still processing | Attempt still `PENDING` (webhook hasn't landed yet) | "We're confirming your payment" + polling widget (client, bounded exponential backoff, e.g. every 2s up to ~30s then settle on "check your email/orders") |
| Initialization failure (never reached Paystack) | `payment.outcome === "INITIALIZATION_FAILED"` from the checkout/retry response itself | Immediate "couldn't start payment" + retry CTA — no redirect ever happened, so this state is reached without a Paystack round-trip at all |
| User returned without completing payment | Attempt still `PENDING`/`INITIATED`-adjacent, user just navigated back | Same as "pending," with a manual "I've completed payment, refresh status" button in addition to auto-poll |
| Retry payment | Any terminal failure state (`FAILED`, `INITIALIZATION_FAILED`, `ABANDONED`) on an order still `PENDING_PAYMENT` | `POST /api/orders/[orderId]/retry-payment` → new `InitializePaymentResult` → same redirect-or-show-error branch as checkout |

### 13.3 Polling design
A small client component (`PaymentResultPanel`) polls `GET /api/orders/[orderId]/payment-attempts` on a bounded backoff schedule while status is non-terminal, stops polling once terminal (`SUCCESS`/`FAILED`/`ABANDONED`) or after a max window, and always shows the **last authoritative server response**, never a locally-inferred status. This directly implements the approval message's explicit rule: *"Do not infer payment success from the browser redirect alone... the page must obtain authoritative payment/order state from the server."*

### 13.4 The guest-authentication gap, and three options (decision required before backend work starts)
Per §3.6, an unauthenticated guest cannot call `GET /api/orders/[orderId]/payment-attempts` at all today (`401` before any ownership check runs). Three options, presented for explicit approval — **none of these are implemented by this plan**:

**Option A — Stateless signed guest-order-access token (recommended).** `completeCheckout`'s response, for guest orders only, includes a short-lived HMAC-signed token (`sign({orderId, exp}, serverSecret)`) — the same primitive already used for Paystack signature verification (`src/integrations/paystack/signature.ts`) and session/reset tokens (`src/integrations/crypto/tokens.ts`), just applied to a new purpose. The frontend carries this token forward to `/checkout/payment-result` (URL param or client-side state) and a new guest-scoped read path accepts it in place of a session. **No schema change** — the token is stateless and self-verifying, not stored. Small new backend surface: a signing/verification helper + one new conditional branch in the payment-attempts read path (or a parallel guest-only route) — additive, no change to the existing authenticated path.

**Option B — No live status for guests; static confirmation only.** After checkout, the frontend already holds the full `OrderDetail` + initial `InitializePaymentResult` in memory. On return from Paystack, show a generic "your payment is being processed — check your email for confirmation" message without any authoritative live read. Zero new backend code, but a materially worse guest UX (no way to detect/react to a failed payment in-session) and would need an email-confirmation mechanism that also doesn't exist yet (no email transport is configured — `lib/env.ts` has no email provider vars, §27).

**Option C — Require an account for checkout.** Eliminates the gap entirely but removes guest checkout, which Phase 7 explicitly built and Phase 8 explicitly threaded a `guestEmail` path through end-to-end for. Rejected as a regression, listed only for completeness.

This plan recommends **Option A** but does not implement it — it is called out again in §33 as a required decision point.

## 14. Order UX

`/account/orders` (list, `listMyOrders` — no permission check, always scoped to `actor.id`) and `/account/orders/[orderId]` (detail, `getOrderById` — ownership-or-`orders.read`). Both routes already exist server-side; only the pages are new. Order detail shows: order number, status (`OrderStatusBadge`), items (immutable `productNameSnapshot`/`skuSnapshot`/`unitPriceMinor`/`quantity`/`lineTotalMinor` — never re-joined against current catalog data, since these are point-in-time snapshots by design), addresses, status history, and — when `order.status === "PENDING_PAYMENT"` — the retry-payment CTA and cancel CTA (both already permission/ownership-checked server-side; the UI only needs to hide them when clearly inapplicable, never relies on hiding them *as* the security control).

## 15. Guest vs. Authenticated Behavior

| Capability | Guest | Authenticated |
|---|---|---|
| Browse/search/filter/PDP | Yes | Yes |
| Add to cart | Yes (cookie-identified) | Yes |
| Checkout | Yes (`guestEmail` required) | Yes |
| Immediate post-checkout payment-result | Yes, **pending §13.4 decision** | Yes (session already covers it) |
| Persistent cart across devices | No (cookie-scoped only) | Yes |
| Order history | No — **not invented** (§3.6/§13.4); a guest's only record of their order is the checkout response itself and (if Option A is later approved) the signed token | Yes (`/account/orders`) |
| Payment retry after leaving the payment-result page | No, unless Option A is approved | Yes |

This table is intentionally conservative — it reflects exactly what the backend supports today plus the one explicitly-flagged pending decision, per the instruction not to invent guest capabilities the backend doesn't support.

## 16. Consultation / Installation Integration

Per §2.5: `ServiceRequest` is schema-only — no module, no use-case, no route exists. Building a working submission flow (`POST` → `service_requests` row → admin `consultations.read`/`update` workflow) is real, non-trivial backend scope (repo, use-cases, Zod schemas, a route, RBAC wiring to the already-seeded `consultations.*` permissions) that this plan **will not silently add to Phase 9**, per the explicit instruction.

Recommended Phase 9 scope for `/consultation` and `/installation`: **static entry-point pages** with a clear CTA (e.g., `mailto:`/`tel:` links sourced from static config, or an embedded third-party form if the business already uses one — not something this plan invents) rather than a form that posts to a nonexistent endpoint. This is called out as an explicit **dependency** (§27) and **open question** (§28): if a real in-app submission flow is wanted for Phase 9's launch, it requires a small prerequisite backend addition (its own repo/use-cases/routes, still no schema change since the table exists) that needs its own scoping and approval — this plan does not assume that decision either way.

## 17. SEO

- `generateMetadata` on every public page, sourced from the same catalog/order-adjacent data the page already fetches (§7) — never a parallel "SEO data" fetch. PDP: `seoTitle ?? name`, `seoDescription ?? shortDescription`. Category/brand landing: same pattern from `CatalogCategory`/`CatalogBrand`'s own `seoTitle`/`seoDescription` fields (category already has them; brand does not — `Brand` has no `seoTitle`/`seoDescription` columns, confirmed in schema — brand pages fall back to a templated title/description, not a schema-backed one, and that gap is noted rather than silently worked around).
- Canonical URLs: `https://<domain>/products/[slug]` etc. — slugs are globally unique and immutable-by-convention (no slug-change/301-redirect handling exists yet; noted as a future gap, not blocking).
- Open Graph / Twitter card metadata: product name/description/primary image.
- JSON-LD: `Product` (name, image, description, offers: price/currency/availability derived from `priceMinor`/`getAvailableQuantity`, brand) on PDPs; `BreadcrumbList` on category/product pages. No `AggregateRating` (no reviews exist, §2.5) — omitted, not stubbed with fake data.
- `app/sitemap.ts`: generates URLs for every `ACTIVE`, non-deleted product (`listProductsPublic` paginated internally) and every active category — using Next's native sitemap route convention, paginated (`sitemap.xml` index + numbered sub-sitemaps) once volume warrants it, single sitemap otherwise.
- `app/robots.ts`: disallow `/account`, `/checkout`, `/cart`, `/api` — matching `docs/ARCHITECTURE.md` §14's own stated list (adjusted: no `/admin` route tree exists in the public app today, but the disallow rule costs nothing to include defensively).

## 18. Image Strategy

Uses the existing `product_images` model as-is (§3.1) — `url, altText, width, height, isPrimary, sortOrder`, no schema change. Delivery: Next.js `<Image>` everywhere, `sizes` tuned per breakpoint (grid card vs. PDP hero vs. gallery thumbnail), explicit `width`/`height` (already stored) to eliminate layout shift, primary image on PDP `priority`-loaded (LCP candidate), all others lazy. `alt` falls back to the product name when `altText` is null (never an empty/missing `alt`, per accessibility §20).

**Open dependency, not resolved by this plan**: `next.config.ts` has no `images.remotePatterns` configured today, and there is no object-storage/CDN integration anywhere in the codebase (`lib/env.ts` has no storage-provider env vars). Product image `url` values are currently just arbitrary `VarChar(500)` strings with no validated host. Before `next/image` can optimize remote product images in production, either (a) a `remotePatterns` entry needs the actual image host decided (S3/CDN domain, per `docs/ARCHITECTURE.md` §13's own "decided at Phase 17" note — which pre-dates this phase and was never resolved), or (b) images are served from this app's own `public/`/an already-known domain for the Phase 9 launch. **Listed as an open question (§28)** — this plan does not invent a storage provider decision.

## 19. Performance

- Server Components by default; the only Client Components are genuine interaction leaves (§6) — kept small so their JS bundle stays minimal, per the approval message's explicit instruction.
- Cache Components (§8) gives static-shell-first rendering for all public catalog pages; `<Suspense>` boundaries isolate the few genuinely dynamic slices (`StockBadge`, cart count in the header, payment-result polling) so they stream independently rather than blocking the whole page.
- No N+1s: `listProducts`/`getProductBySlug` already fetch brand/category/primary-image/default-variant in one query each (confirmed in §3.1 grounding) — the storefront must not add a per-card follow-up query (e.g., a naive per-card `getAvailableQuantity` call in a listing loop would be exactly the N+1 this must avoid; listing pages show price/compare-price only, not live stock — stock display is a PDP-only, single-variant concern per §10).
- Keyset pagination throughout (§9) — no `OFFSET` anywhere, matching the established cross-module convention.
- Parallel data fetching: independent reads for a given page (e.g., PDP's `getProductBySlug` + "related products" `listProducts`) issued as sibling `Promise`s / sibling Server Components under one `<Suspense>` tree, not sequential `await`s creating an artificial waterfall.
- Minimal client-JS footprint: no global client state library (confirmed none installed, §2 grounding) — cart/order data is always server-derived-per-request or returned directly by the mutation response that changed it, never duplicated into a separate always-syncing client store.

## 20. Accessibility

- Semantic HTML throughout (`<nav>`, `<main>`, `<button>` vs. `<div onClick>`, proper heading hierarchy per page).
- Full keyboard navigation and visible focus rings on every interactive element (shadcn primitives ship this by default — do not override `outline: none` anywhere without an equivalent focus-visible replacement).
- Accessible dialogs/sheets: shadcn's `dialog`/`sheet` (Base UI-backed, confirmed `@base-ui/react` is already a dependency) handle focus-trap/ESC-to-close/ARIA roles correctly out of the box — use them as-is, don't hand-roll modal behavior.
- Form errors: every field-level Zod validation error surfaced with `aria-describedby`/`aria-invalid`, not color alone.
- Screen-reader announcements for async state changes: cart-count update, payment-result state transitions (`aria-live="polite"` region), add-to-cart confirmation toast.
- Sufficient color contrast against the existing `oklch`-based shadcn token palette — verified per-component during implementation, not assumed.
- `prefers-reduced-motion` respected for any transition/animation (image gallery, drawer open/close, toast).
- Product gallery: thumbnail buttons with descriptive `aria-label`s ("View image 2 of 5"), main image `alt` text always populated (§18).

## 21. Security

- Every mutating client interaction goes through the existing Zod-validated, server-owned routes/use-cases (§3) — the storefront introduces no new trust boundary. No price/stock/order-total/payment-status/order-status field is ever accepted from the client anywhere.
- XSS: React's default escaping covers all dynamic text; product `description`/specification values are plain text fields in the schema (`@db.Text`/`@db.VarChar`, not HTML) — render as text, not `dangerouslySetInnerHTML`, unless a future rich-text requirement explicitly changes the schema (out of scope here).
- CSRF: Server Actions get Next's built-in origin check; the one unauthenticated `POST` (`/api/paystack/webhook`) is already signature-protected and entirely out of this phase's scope to touch.
- IDOR: every order/payment page relies on the existing server-side ownership-or-permission check (§3.5) — the frontend must never hide a "cancel"/"retry" button as its only protection; the underlying route already rejects unauthorized attempts regardless of what the UI shows.
- No secret exposure: `PAYSTACK_SECRET_KEY`/`INTERNAL_WORKER_SECRET`/`DATABASE_URL` are never read by any Client Component or sent to the browser; only `NEXT_PUBLIC_*`-prefixed values would ever reach the client bundle, and none of the new work in this phase needs one.
- Safe external redirect: the only cross-origin navigation the app performs is `window.location.href = payment.authorizationUrl`, a URL that originates from Paystack's own API response (never client-constructed), reducing open-redirect risk to "trust Paystack's own domain," which is the same trust boundary Phase 8 already accepted.
- Rate limiting: explicitly out of scope for this phase (matches `docs/ARCHITECTURE.md` §17's own "Phase 17" placement) — noted as a future dependency, not silently added or silently skipped-without-mention.
- Forged product/variant IDs: every cart/checkout mutation re-resolves the variant server-side (`resolveVariantForCart`, `resolveOrderLine`) — a forged `variantId` for a nonexistent/archived variant is rejected server-side today; the frontend needs no additional defense beyond normal input validation UX.

## 22. Error / Loading / Empty States

Per-route `loading.tsx`/`error.tsx`/`not-found.tsx` where the route's own data-fetching can meaningfully fail or take time — not one global generic spinner:

| Route | `loading.tsx` | `error.tsx` | `not-found.tsx` | Empty state |
|---|---|---|---|---|
| `/products` | Skeleton grid | Generic retry | — | "No products match your filters" + clear-filters CTA |
| `/products/[slug]` | Skeleton PDP | Generic retry | Product not found (mirrors `getProductBySlug`'s `NotFoundError`) | — |
| `/categories/[slug]`, `/brands/[slug]` | Skeleton | Generic retry | Not found | "No products in this category yet" |
| `/cart` | Skeleton lines | Generic retry | — | "Your cart is empty" + browse CTA |
| `/checkout` | Skeleton form | Generic retry | Redirect to `/cart` if no active cart (matches the existing `NotFoundError` the route already throws) | — |
| `/checkout/payment-result` | Explicit "confirming your payment" state (not a generic skeleton — this is a meaningfully different loading state, §13.2) | Generic retry, with a link back to `/account/orders`/a support contact | — | — |
| `/account/orders` | Skeleton rows | Generic retry | — | "You haven't placed an order yet" + browse CTA |
| `/account/orders/[orderId]` | Skeleton | Generic retry | Order not found / not yours (403 surfaces as a not-found-shaped message, never leaking "this order exists but isn't yours") | — |

## 23. Testing Strategy

- **Unit**: money/quantity formatting helpers (`PriceDisplay` logic), filter-to-`searchParams` serialization, `ProductSummary`/`ProductDetail` → view-model transforms (if any), payment-result state derivation (given a `PaymentAttemptRecord[]`, which UI state to show — pure function, directly unit-testable).
- **Integration** (Vitest + real MySQL, matching every prior phase's convention — **never mock our own repositories**): the two new by-slug catalog reads (§31), the extended `listProductsPublic` filters (price range, solar facets, sort=featured), any new guest-order-access-token verification logic (if/when Option A from §13.4 is approved) — tested exactly like Phase 8's `fake-Paystack-client` boundary tests (real MySQL, real app code, only the true external system faked).
- **E2E** (Playwright, `request` fixture, no browser — matching the established convention across all 7 existing e2e spec files): a **new** `tests/e2e/storefront.spec.ts`, additive, never modifying the existing Phase 3–8 e2e files except where a genuinely shared fixture needs extending (e.g., `global-teardown.ts` gets a `Phase9E2E`-prefixed cleanup block, same pattern as every phase before it).

## 24. E2E Scenarios (minimum set, real HTTP)

1. Browse catalog listing (`GET` equivalent via a Server Component render — actually exercised via the underlying `/api/catalog/products` route the same page would call server-side, since Playwright's `request` fixture tests the HTTP contract, not the rendered HTML).
2. Search/filter products (category, brand, search term, price range, solar facet).
3. View a single product by slug.
4. Add a product to a guest cart.
5. Update/remove a cart item.
6. Register + log in, confirm guest cart merges into the new session's cart (reuses the existing `mergeGuestCartIntoUserCart` behavior, already covered at the integration level in Phase 7 — this e2e test confirms the HTTP-level wiring only).
7. Complete checkout (guest and authenticated variants).
8. Confirm the checkout response's `payment.outcome` branches correctly (with no `PAYSTACK_SECRET_KEY` configured in this environment, `INITIALIZATION_FAILED` is the real, expected outcome — matching every prior phase's e2e convention, not a workaround).
9. Retry a failed/uninitalized payment via `POST /api/orders/[orderId]/retry-payment`.
10. Read customer order history (`GET /api/orders`) and a single order detail — authenticated only, matching §3.5.
11. IDOR: a different user cannot read another customer's order/payment-attempts (mirrors the existing Phase 6/8 e2e IDOR tests exactly, just against any new page-adjacent route if one is added).
12. Whatever guest-payment-status option is approved from §13.4 gets its own e2e coverage once implemented — not assumed here.

Responsive/visual regression across breakpoints is **not** covered by this `request`-fixture-only e2e layer (it never renders a browser) — if visual/responsive regression testing is wanted, that is a separate tooling decision (e.g., Playwright's browser mode or a visual-diff tool), not silently bundled into this phase's existing e2e convention.

## 25. Performance Verification

Not claimed as achieved during planning, per the explicit instruction — only how it will be measured once built:
- Lighthouse (or equivalent) run against `/`, `/products`, `/products/[slug]`, `/cart`, `/checkout` in a production build, recording LCP/INP/CLS as a baseline at the end of implementation, not before.
- Server response time and database query count per route, measured the same way `docs/ARCHITECTURE.md` §18 already commits to for catalog listings — an integration/dev-tooling check asserting query count on the listing/PDP routes stays flat (no accidental N+1 introduced by a new filter), reusing Prisma's query-logging or an explicit test assertion, decided at implementation time.
- Client-JS bundle size / Client-Component footprint tracked via `next build`'s own route-size output (already visible in every prior phase's build verification step) — flagged if a page's client bundle grows unexpectedly relative to its actual interactivity needs.

## 26. Deployment Considerations

No new deployment concern beyond what Phases 1–8 already established (`docs/ARCHITECTURE.md` §15 — Node.js runtime only, no Edge routes, since Cache Components requires it). The storefront introduces no new environment variable **unless** §13.4's Option A (a new signing secret for guest-order-access tokens) is approved — in which case one new optional-at-first, then-required env var would be added to `lib/env.ts` following the exact pattern `PAYSTACK_SECRET_KEY`/`INTERNAL_WORKER_SECRET` already established in Phase 8. No new infrastructure (no Redis, no queue, no search service) is introduced, per the explicit constraints carried over from Phase 8's own approval.

## 27. Dependencies

- **§13.4 decision** (guest payment-status access) — blocks full guest Payment-Return UX until resolved; Options B/C can ship without it if the guest experience is intentionally reduced for launch.
- **§16 decision** (consultation/installation: static CTA vs. new backend) — blocks a working in-app submission form; a static CTA needs no dependency at all.
- **§18 image hosting decision** (object storage/CDN domain for `next/image` `remotePatterns`) — blocks correctly-optimized remote product images in production; `unoptimized` or same-origin images could unblock a Phase 9 launch without this being resolved first, at a real image-optimization cost.
- **§9 "in stock only" filter decision** — blocks that one filter only; every other filter ships without it.
- No dependency on Redis, Elasticsearch, a queue, or any service not already present in `docker-compose.yml`/`package.json`.
- No dependency on the `ServiceRequest`, `Review`, `Coupon`, or `Settings` modules being built — Phase 9 explicitly does not require them (§2.5, §16, §32).

## 28. Open Questions

1. Which of §13.4's three options for guest payment-status access should be implemented, and when (blocking Phase 9's initial ship, or a fast-follow)?
2. Is a real, backend-backed consultation/installation submission form required for Phase 9's launch, or is a static CTA acceptable for now (§16)?
3. What is the actual image-hosting story (object storage provider + CDN domain) for `next/image` `remotePatterns` (§18) — or is `unoptimized`/same-origin acceptable for an initial launch?
4. Should "in stock only" become a true listing filter (requiring a cross-module architecture decision, §9), or stay a per-PDP display-only concern indefinitely?
5. Is price-sort (`price_asc`/`price_desc`) needed at initial launch, or acceptable as a fast-follow (§9)?
6. Should the checkout address form be a Server Action or a client `fetch` against the existing route (§12) — a real but low-stakes implementation-time choice, not resolved here since either is architecturally sound.
7. Does the business have real branding/copy/imagery for the home page hero, trust signals, and consultation/installation CTAs, or should Phase 9 ship with clearly-labeled placeholder content pending real content (per the explicit instruction not to invent business copy)?

## 29. Risks

1. **The guest-payment-status gap (§13.4) is the single biggest risk to a good guest checkout experience** if left unresolved — a guest whose payment fails or is delayed has no way to find out without checking email (which itself has no configured transport, §27) or contacting support. Mitigation: resolve §13.4 before considering guest checkout "done," even if Phase 9 ships authenticated checkout first as a fallback sequencing (§30).
2. **Cache Components is new to this codebase** (confirmed zero prior usage, §2.3) — the first real usage in Phase 9 is where any misunderstanding of the `"use cache"`/`cookies()` interaction (a hard build error if a cached function ever touches `cookies()`/`headers()`) will surface. Mitigation: establish the pattern on one page first (e.g., category tree) before repeating it across every catalog page, matching `docs/ARCHITECTURE.md` §19 risk #2's own mitigation plan.
3. **LIKE-based search (§9) will degrade as the catalog grows** — not a Phase 9 blocker, but a known, disclosed technical-debt item that should be revisited once real product-count data exists, not discovered painfully in production.
4. **No object storage/CDN decision exists yet (§18)** — if Phase 9 ships with `unoptimized` images or same-origin storage as a stopgap, that choice needs to be revisited deliberately later, not forgotten.
5. **Zero existing UI/component work to build on** (§2.2 — only one shadcn component exists) means Phase 9's component-library buildout (§6) is real, non-trivial scope in its own right, not a thin veneer over existing components — sequencing (§30) should account for this rather than assume component work is incidental.

## 30. Implementation Sequence (proposed, for the eventual implementation-approval message — not started here)

1. Design tokens + app shell (`layout.tsx`, header/footer/mobile nav) + shadcn primitive buildout (§6).
2. Catalog read-side additive backend work (§31: by-slug category/brand reads, extended listing filters) + Cache Components wiring (§8) — the two smallest, lowest-risk, most foundational pieces.
3. Home, product listing, PDP (consumes #1 and #2).
4. Cart page + drawer (consumes existing, unmodified cart API).
5. Checkout page (consumes existing, unmodified checkout API) — **authenticated checkout first**, since it has no §13.4 dependency.
6. Payment-result page for the authenticated path (fully unblocked already).
7. Account order list/detail pages.
8. **Decision checkpoint**: resolve §13.4 (guest payment-status) and §16 (consultation/installation) before proceeding to guest checkout's payment-result experience and the consultation/installation pages, respectively — both can be built in parallel with #2–7 once decided, or deferred to a fast-follow without blocking the authenticated-first launch.
9. SEO (`sitemap.ts`, `robots.ts`, `generateMetadata`, JSON-LD) — layered on once the pages it describes exist.
10. Full test suite (§23/§24) + performance verification (§25) + final regression check against Phases 3–8's own suites (matching every prior phase's completion discipline).

## 31. Files Expected to Be Created / Modified

**New backend reads (additive, no schema change, no change to any existing function's signature/behavior):**
- `src/modules/catalog/repo.ts` — add `findCategoryBySlugPublic(slug)`, `findBrandBySlugPublic(slug)`; extend `ListProductsFilters`/`listProductsPublic` with `minPriceMinor?, maxPriceMinor?, powerRatingWMin?/Max?, voltageV?, phase?, sortBy?: "newest"|"featured"` (all optional, default behavior unchanged for existing callers).
- `src/modules/catalog/schema.ts`/`types.ts` — corresponding optional Zod fields and TS types.
- `src/modules/catalog/use-cases/get-category-by-slug.ts`, `get-brand-by-slug.ts` — new, mirroring `get-product-by-slug.ts` exactly (public, no actor).
- `app/api/catalog/categories/[slug]/route.ts`, `app/api/catalog/brands/[slug]/route.ts` — new public GET routes, only if a client-side (not Server-Component-direct) consumer ever needs them; likely **not needed** given §7's direct-call preference for server-rendered pages — included here only as a possibility, not a commitment.
- `revalidateTag`/`updateTag` calls added inside the existing catalog write use-cases listed in §8 — additive statements, no signature change.
- `src/integrations/paystack/client.ts` — `initializeTransaction` call gains a `callback_url` parameter pointing at `/checkout/payment-result` (§13.1) — additive to the request payload, no interface change to `PaystackClient`.
- **Only if §13.4 Option A is approved**: a new stateless token sign/verify helper (likely `src/integrations/crypto/guest-order-token.ts`, mirroring `src/integrations/crypto/tokens.ts`'s pattern) + a small additive branch in the payment-attempts read path or a parallel guest-scoped route + one new optional env var in `lib/env.ts`.

**New frontend (all net-new files — nothing here overlaps Phase 3–8's own files beyond the two `MODIFIED` lines below):**
- `app/page.tsx` (MODIFIED — replaces starter content), `app/layout.tsx` (MODIFIED — real shell), `app/globals.css` (MODIFIED only if new tokens are needed)
- `app/products/page.tsx`, `app/products/[slug]/{page,loading,not-found}.tsx`
- `app/categories/[slug]/page.tsx`, `app/brands/[slug]/page.tsx`
- `app/cart/page.tsx`
- `app/checkout/{page.tsx,actions.ts}`, `app/checkout/payment-result/page.tsx`
- `app/consultation/page.tsx`, `app/installation/page.tsx`
- `app/account/orders/page.tsx`, `app/account/orders/[orderId]/page.tsx`
- `app/sitemap.ts`, `app/robots.ts`
- `app/login/page.tsx`, `app/login/login-form.tsx`, `app/account/page.tsx` (MODIFIED — restyled only, no behavior change)
- `components/ui/*` (new shadcn primitives, §6), `components/storefront/*` (new composed components, §6)

**New tests:**
- `tests/integration/catalog-by-slug.test.ts` (or extending an existing catalog integration file), extended `listProductsPublic` filter tests
- `tests/e2e/storefront.spec.ts`
- `tests/e2e/global-teardown.ts` — additive `Phase9E2E`-prefixed cleanup block

**Nothing else in `src/modules/{cart,checkout,order,payment,auth,inventory}` or `prisma/schema.prisma` is modified**, except the one narrowly-scoped §13.1 addition to the Paystack client call and (conditionally) the §13.4 Option A backend addition.

## 32. Explicit Out-of-Scope List

- Admin dashboard, product/order/refund/inventory management UI (any of it) — customer-facing only, per explicit instruction.
- Any change to payment/refund business logic, state machines, or the deferred refund-webhook-processing decision from Phase 8 — inherited constraint, not re-opened.
- A working `ServiceRequest`/consultation backend (repo/use-cases/routes) unless §28 Q2 is explicitly resolved in favor of building it.
- Product reviews UI/backend (`Review` model is schema-only, §2.5).
- Coupon-code UI/backend (`Coupon` model is schema-only; `completeCheckoutSchema` has no coupon field today).
- `Settings`/`SettingEntry`-backed dynamic site configuration (support email, default currency, etc.) — treated as static config/content for this phase, not a live-editable admin setting.
- Elasticsearch/OpenSearch/Algolia/Meilisearch, Redis, any new queue/worker infrastructure.
- A database migration of any kind.
- Rate limiting (explicitly deferred, matching the existing architecture doc's own placement).
- Visual/browser-based regression testing (the existing e2e convention is HTTP-contract-only, §24).
- A guest order-lookup-by-order-number-and-email feature (not requested, not backed by an existing route, would itself need its own IDOR analysis if ever proposed).

## 33. Hard-Stop Criteria

Per the approval message's own §28, re-evaluated against everything grounded above:

- ✅ Existing catalog APIs **can** support the storefront (with the small additive reads in §31) — no stop.
- ⚠️ **Service-request functionality is insufficient** and *would* require unplanned backend scope if a working consultation/installation form is wanted for launch — **not a stop on producing this plan**, but implementation of a real submission flow must not proceed without the §28 Q2 decision.
- ✅ Checkout safely returns a payment authorization URL today — no stop.
- ✅ Payment-result state can be queried authoritatively **for authenticated customers** — no stop for that path. **For guest customers, it currently cannot** (§3.6/§13.4) — this is the plan's one genuine "insufficient existing authorization" finding from the hard-stop list; it does not block this planning document, but it does block *implementing* the guest Payment-Return experience until §28 Q1 is decided.
- ✅ Existing cart APIs fully support every required interaction — no stop.
- ✅ Cache Components can safely model the required cache boundaries (§8) — no stop.
- ✅ No database migration is required for anything in this plan's in-scope work — no stop.
- ✅ Existing authorization is sufficient for every authenticated flow; insufficient only for the one disclosed guest-status-read gap above.
- ✅ Product visibility semantics are clear and already correctly enforced (`status: ACTIVE`, `deletedAt: null`, variant `status: ACTIVE`).
- ⚠️ **Current image storage/rendering contract is incomplete** (no `remotePatterns`/CDN decision, §18/§28 Q3) — not a stop on this plan, but a real gap to resolve before or during implementation.

**Net result: this plan does not need to stop before proceeding to an implementation-approval request.** It surfaces two genuine decisions (§13.4 guest payment status; §16 consultation backend scope) and one genuine infrastructure gap (§18 image hosting) that should be explicitly resolved — via approval, not silent assumption — before the specific pieces of implementation that depend on them begin. Every other planned piece of work is fully supported by the existing, verified backend.

---

**PHASE 9 PLAN COMPLETE — AWAITING APPROVAL**

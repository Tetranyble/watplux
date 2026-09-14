# Phase 9 — Storefront Implementation Report

## 1. Scope delivered

The full approved Phase 9 scope from `docs/PHASE_9_STOREFRONT_PLAN.md`, exactly as approved, including the guest payment-status Option A decision:

- Design system + app shell: header, footer, mobile nav, cart drawer, shadcn primitives (`base-nova`, Tailwind v4, Lucide — no other UI framework introduced).
- Catalog backend extensions: category/brand by-slug public reads, price-range + solar-facet listing filters, `newest`/`featured` sort (with a correctly-extended 3-level keyset cursor for the featured boundary), cache invalidation wiring.
- Cache Components (`"use cache"`/`cacheTag`/`cacheLife`/`revalidateTag`) established on the public catalog reads, and nowhere else — cart, checkout, payment-result, and account pages remain fully dynamic.
- Home, product listing (with filter/sort UI), category landing, brand landing, product detail (gallery, variant/quantity selector, live stock, spec table, related products, JSON-LD).
- Cart page + drawer, both driven by the existing, unmodified Phase 7 cart API.
- Checkout page (address form only — see §18) driving the existing, unmodified Phase 8 checkout/payment API.
- Authenticated and guest payment-result pages with bounded polling, backed by the guest-order-access token (§13.4 Option A, fully implemented per the approval's exact requirements).
- Account order history + order detail, with cancel/retry actions.
- Static consultation/installation entry points (no `ServiceRequest` backend, per the explicit instruction).
- SEO: per-route `generateMetadata` (title/description/canonical/OG/Twitter), `Product` + `BreadcrumbList` JSON-LD on PDPs, `app/sitemap.ts`, `app/robots.ts`.
- Full test suite: unit, integration, and e2e, described in §12.

**Zero database migrations.** `prisma/schema.prisma` was not touched.

## 2. Files created

**Design system / app shell:**
- `lib/site-config.ts`, `lib/format.ts`
- `components/storefront/site-header.tsx`, `site-footer.tsx`, `mobile-nav.tsx`, `product-image.tsx`
- `app/_components/cart-count-badge.tsx`, `account-nav-area.tsx`
- 16 new shadcn primitives: `components/ui/{badge,input,select,checkbox,dropdown-menu,table,skeleton,alert,sonner,separator,tabs,breadcrumb,label,textarea,dialog,sheet}.tsx`

**Catalog backend extensions:**
- `src/modules/catalog/use-cases/get-category-by-slug.ts`, `get-brand-by-slug.ts`
- `app/_data/catalog.ts` (the one place `"use cache"`/`cacheTag`/`cacheLife`/`revalidateTag` are used in this codebase), `app/_data/misc.ts`

**Pages:**
- `app/products/{page,loading}.tsx`, `app/products/[slug]/{page,loading,not-found}.tsx`
- `app/categories/[slug]/{page,not-found}.tsx`, `app/brands/[slug]/{page,not-found}.tsx`
- `app/cart/{page,loading}.tsx`
- `app/checkout/{page,loading}.tsx`, `app/checkout/payment-result/{page,loading}.tsx`
- `app/account/orders/{page,loading}.tsx`, `app/account/orders/[orderId]/{page,loading,not-found}.tsx`
- `app/consultation/page.tsx`, `app/installation/page.tsx`
- `app/sitemap.ts`, `app/robots.ts`

**Storefront components:**
- `components/storefront/product-card.tsx`, `product-grid.tsx`, `price-display.tsx`, `product-gallery.tsx`, `product-purchase-panel.tsx`, `spec-table.tsx`, `product-filter-form.tsx`
- `components/storefront/cart-line-item.tsx`, `cart-list.tsx`, `cart-summary.tsx`, `cart-drawer.tsx`
- `components/storefront/checkout-address-form.tsx`, `payment-result-panel.tsx`
- `components/storefront/order-status-badge.tsx`, `order-actions.tsx`

**Guest payment-result token (§13.4 Option A):**
- `src/integrations/crypto/guest-order-token.ts` — stateless HMAC-SHA256 sign/verify, never stored
- `src/modules/payment/use-cases/verify-guest-order-token.ts`, `list-payment-attempts-for-guest-order.ts`, `retry-payment-for-guest-order.ts`

**Tests:**
- `tests/unit/format.test.ts`, `guest-order-token.test.ts`, `payment-result-state.test.ts`
- `tests/integration/catalog-storefront.test.ts`, `guest-order-access.test.ts`
- `tests/e2e/storefront.spec.ts`

## 3. Files modified (additive extensions; every existing behavior preserved)

- `app/layout.tsx`, `app/page.tsx`, `app/globals.css` — replaced the starter shell/homepage with the real one; `app/globals.css` only gained no new tokens (unchanged design tokens, just consumed).
- `app/account/page.tsx`, `app/login/page.tsx`, `app/login/login-form.tsx` — visual restyle only (shadcn components); the Server Action wiring (`loginFormAction`, `logoutAction`, `logoutAllAction`, `useActionState`) is byte-for-byte unchanged.
- `src/modules/catalog/repo.ts` — additive: `findCategoryBySlugPublic`, `findBrandBySlugPublic`; `ListProductsFilters`/`listProducts` extended with `minPriceMinor`, `maxPriceMinor`, `powerRatingWMin`, `powerRatingWMax`, `voltageV`, `phase`, `sortBy` (all optional); `CursorInput`/`encodeProductCursor`/`decodeProductCursor` extended with an optional `isFeatured` field for the featured-sort keyset. Every existing caller (admin listing, Phase 4 tests) that omits these new fields gets byte-identical prior behavior — confirmed by the full, unmodified Phase 4 catalog suite (69 tests) passing unchanged.
- `src/modules/catalog/schema.ts` — `listProductsSchema`/`listProductsForAdminSchema` extended with the same new optional fields (restructured into a shared base object + `withPriceRangeCheck`, mirroring the file's own `withMpptRangeCheck` convention, so the admin schema could still `.extend()` the base — a `ZodEffects` cannot be extended); added `getCategoryBySlugSchema`, `getBrandBySlugSchema`.
- `src/modules/catalog/use-cases/list-products.ts`, `list-products-for-admin.ts` — pass the new optional filters through to the repo call; no other change.
- 13 `app/api/admin/catalog/**` routes — additive `revalidateCatalogProducts`/`revalidateCatalogCategories`/`revalidateCatalogBrands` calls after the existing mutation succeeds (Cache Components invalidation, §8 of the plan); no change to request/response contracts, auth, or validation.
- `src/modules/checkout/use-cases/complete-checkout.ts` — `CompleteCheckoutOutcome` gains an additive `guestOrderAccessToken?: string` field, populated only for guest orders when `GUEST_ORDER_TOKEN_SECRET` is configured; every existing field/behavior unchanged, confirmed by the full Phase 7 checkout suite passing unmodified.
- `app/api/checkout/route.ts` — response now also includes `guestOrderAccessToken`; no other change.
- `src/modules/payment/use-cases/initialize-payment.ts` — the pre-existing but previously-unpopulated `callbackUrl` field on `InitializeTransactionParams` (Phase 8) is now actually set, to `${APP_BASE_URL}/checkout/payment-result?orderId=...` (plus `&guestToken=...` for guest orders) — see §7/§16 bug 1 for why this was necessary and previously missing. `orderRepo.findOrderById` is called once, read-only, purely to determine guest-vs-authenticated for the callback URL.
- `app/api/orders/[orderId]/payment-attempts/route.ts`, `app/api/orders/[orderId]/retry-payment/route.ts` — additive guest-token path (checked before the session requirement); the existing authenticated path (`requireSessionUser` → `listPaymentAttemptsForOrder`/`retryPayment`) is completely unchanged and still the only path when no token is presented.
- `src/modules/payment/schema.ts` — `retryPaymentSchema` gains an additive optional `guestToken` field; every existing `{}` caller still validates identically.
- `src/modules/payment/constants.ts` — added `GUEST_ORDER_TOKEN_TTL_SECONDS`.
- `lib/env.ts` — added `APP_BASE_URL` (required with a `localhost` default) and `GUEST_ORDER_TOKEN_SECRET` (optional, fail-closed if unset). `.env.example` documents both.
- `tests/e2e/global-teardown.ts` — additive `Phase9E2E` cleanup block, plus two small hardening fixes discovered during this phase's own verification (§16 bugs 4–5).

**Nothing in `src/modules/{cart,order,inventory,auth}` or `prisma/schema.prisma` was touched.** The payment/refund state machines, webhook processing, and the Phase 8 refund-webhook deferral are untouched and were not reopened.

## 4. Database / migration status

**Zero migrations.** Confirmed sufficient for the entire approved scope, including the guest-order-access token (deliberately stateless — no new table).

## 5. Design system

`components.json`'s existing `base-nova` / `neutral` / Tailwind v4 / Lucide configuration was used as-is. 16 new shadcn primitives were added via the shadcn CLI (never hand-rolled, never a different UI framework). One real implementation detail discovered while wiring them: this install's Button/Sheet/DropdownMenu/Breadcrumb primitives are **Base UI**-backed (`@base-ui/react`), which uses a `render` prop, not Radix's `asChild`+`<Slot>` pattern — every composed link-as-button/link-as-menu-item usage in this phase uses `render={<Link .../>}`, not `asChild`.

## 6. Cache Components strategy (implemented exactly per plan §8)

All `"use cache"`/`cacheTag`/`cacheLife`/`revalidateTag` usage lives in one file, `app/_data/catalog.ts` — thin cached wrappers around already-tested public catalog use-cases, never new business logic:

| Read | Tag(s) | Life |
|---|---|---|
| `getCachedCategoryTree` | `catalog:categories` | hours |
| `getCachedBrands` | `catalog:brands` | hours |
| `getCachedCategoryBySlug(slug)` | `catalog:categories`, `catalog:category:{slug}` | hours |
| `getCachedBrandBySlug(slug)` | `catalog:brands`, `catalog:brand:{slug}` | hours |
| `getCachedProductListing(filters)` | `catalog:products` | minutes |
| `getCachedProductBySlug(slug)` | `catalog:products`, `catalog:product:{slug}` | hours |

Invalidation (`revalidateCatalogProducts`/`Categories`/`Brands`) is called from the 13 admin catalog mutation routes right after their existing use-case succeeds, using `revalidateTag(..., "max")` (the current, non-deprecated API — `updateTag` was considered but is Server-Action-only, and these are plain Route Handlers). Cart, checkout, payment-result, and every account/order page are never cached — each reads `cookies()` and is marked `instant = false`, matching `app/account/page.tsx`'s pre-existing Phase 3 convention for the same reason. Confirmed via production build output: every public catalog page shows `◐` (Partial Prerender) with `revalidate`/`expire` values matching its `cacheLife` tier (`1m`/`1h` for the "minutes" tier, `1d`/`1w` for "hours"); every cart/checkout/account page shows `ƒ`/`◐` with no static shell claim beyond its own genuinely-static parts.

## 7. Guest payment-result access token (§13.4 Option A) — full implementation

- **Primitive** (`src/integrations/crypto/guest-order-token.ts`): HMAC-SHA256 over a `{orderId, exp}` payload, `timingSafeEqual` comparison — mirrors the codebase's existing `verifyPaystackSignature` pattern (Phase 8), not the session/reset-token pattern (which requires a stored hash this design deliberately has none of). **Never stored in the database.** Cryptographically signed. Carries an expiration (`GUEST_ORDER_TOKEN_TTL_SECONDS`, 24h). Scoped to exactly one `orderId` — the only claim it ever carries.
- **Fails closed**: `generateGuestOrderToken`/`verifyGuestOrderToken` both return `null` if `GUEST_ORDER_TOKEN_SECRET` is unset, rather than signing with an implicit default — matching `PAYSTACK_SECRET_KEY`'s established discipline.
- **Never exposed to the browser**: the *secret* lives only in `lib/env.ts`/server-side use-cases; the *token* (a bearer credential, not the secret) is the only thing that ever reaches the client, exactly as intended.
- **Not a generic mechanism**: `isValidGuestOrderToken(token, orderId)` (`verify-guest-order-token.ts`) is the only sanctioned check, and it's hard-coded to one purpose — payment-result access for one order. No reusable "guest session" or generic capability token was introduced.
- **Minimum backend surface**: two new guest-scoped use-cases (`listPaymentAttemptsForGuestOrder`, `retryPaymentForGuestOrder`), both re-checking `order.userId === null` as defense in depth (so even a hypothetical token-issuing bug could never leak an authenticated user's data), plus the one verification use-case. The existing authenticated paths (`listPaymentAttemptsForOrder`, `retryPayment`) are **completely unmodified** — confirmed by the full, unmodified payment/checkout integration suites passing unchanged.
- **Wiring**: `completeCheckout` returns the token for guest orders only; `initializePayment` embeds `orderId` (always) and `guestToken` (guest orders only) directly into the Paystack `callback_url`, so a guest redirected back from Paystack lands on a working, self-authorizing `/checkout/payment-result` URL without any client-side plumbing.
- **Tests** (exactly the eight cases the approval required): valid token, expired token, malformed token, tampered token, token-for-another-order, "guest can read only the authorized order/payment state," "authenticated authorization continues to work exactly as before," and IDOR attempts fail — covered across `tests/unit/guest-order-token.test.ts` (11 tests, the crypto primitive in isolation) and `tests/integration/guest-order-access.test.ts` (8 tests, wired against real MySQL orders), plus 4 dedicated e2e tests (`tests/e2e/storefront.spec.ts`) proving the real HTTP path, including a tampered-token 401 and a wrong-order-token 401.

## 8. Storefront architecture

Server Components by default; the only Client Components are genuine interaction leaves: `MobileNav`, `CartDrawer`, `CartList`/`CartLineItem`, `ProductGallery`, `ProductPurchasePanel`, `ProductFilterForm`'s Select fields, `CheckoutAddressForm`, `PaymentResultPanel`, `OrderActions`, `LoginForm`. 12 of 50 (24%) app/storefront component files are Client Components; the rest are Server Components. No Redux/Zustand/global client state library was introduced (confirmed: none installed, none added) — cart/order state is always server-derived per request or returned directly by the mutation response that changed it (`router.refresh()` re-runs the Server Component tree rather than maintaining a parallel client store).

Data-fetching follows the approved boundary exactly: every server-rendered public/account page calls a use-case (cached wrapper for catalog, direct for cart/order/payment) rather than fetching its own `/api/**` route; every client mutation (add-to-cart, cart-item update/remove, checkout submit, retry, cancel) calls the real, existing `/api/**` route, never a shortcut.

## 9. Product detail architecture

Uses the existing `ProductDetail` contract unchanged — variants, images, specifications all come straight from `getCachedProductBySlug`. `SpecTable` renders the 8 typed solar/logistics facet columns already on `ProductVariant` alongside the generic `ProductSpecification` EAV rows in one component, two data sources — no second solar-specification model was created. Price is always rendered via `PriceDisplay`, which only ever formats `priceMinor`/`currency` values that came straight from the backend; it never computes or sends a price anywhere. Live stock (`getAvailableQuantity`, one call per `ACTIVE` variant) is fetched fresh, uncached, directly in the page — never baked into the cached product read, never used for a listing-level filter (§9/§19 of the plan).

## 10. Cart implementation

Uses the existing Phase 7 cart API exactly as-is: `GET /api/cart`, `GET /api/cart/count`, `POST /api/cart/items`, `PATCH`/`DELETE /api/cart/items/[itemId]`, `DELETE /api/cart`. No second cart implementation, no client-side reservation of any kind. `priceSnapshotMinor` is rendered as received, never recomputed or resubmitted. Guest and authenticated carts are handled identically from the frontend's perspective (the backend already abstracts this via `resolveCartActor`); the guest→authenticated merge on login required zero new frontend code (it already happens inside the existing `login()` use-case).

## 11. Checkout implementation

Uses the existing, unmodified Phase 8 `POST /api/checkout` contract. Never accepts or sends price/subtotal/total/discount/tax/SKU/product-name/payment-status from the client — only address + optional guest contact fields, exactly matching the route's own documented contract. `payment.outcome === "PENDING"` → `window.location.href = payment.authorizationUrl` (a real cross-origin redirect to Paystack's own hosted page, never a card form of our own); `payment.outcome === "INITIALIZATION_FAILED"` → hands off to `/checkout/payment-result`, which re-derives everything authoritatively rather than duplicating that UI inline. Billing-address UI is a deliberate, disclosed simplification for this pass (§18) — the backend's optional `billingAddress` field is untouched and still fully functional.

## 12. Tests

- **Unit**: `format.test.ts` (9 tests — price/discount/quantity/date formatting), `guest-order-token.test.ts` (11 tests), `payment-result-state.test.ts` (6 tests — the pure state-derivation function extracted specifically for testability). **26 new unit tests.**
- **Integration** (real MySQL, no repository mocks): `catalog-storefront.test.ts` (11 tests — by-slug reads, price/facet filters, featured-sort keyset correctness across a page boundary), `guest-order-access.test.ts` (8 tests — guest-scoped use-cases + IDOR guards). **19 new integration tests.**
- **e2e** (`tests/e2e/storefront.spec.ts`, Playwright `request` fixture only, no browser — matching every prior phase's convention exactly): 12 tests covering all 17 items on the approval's list (catalog browsing, search, filtering, sorting, guest cart add/update/remove, guest→authenticated merge, authenticated checkout + retry, guest checkout + guest-token-authorized read/retry, tampered-token rejection, cross-order-token rejection, authenticated order history/detail, and IDOR).
- **Full suite totals**: 186 unit tests (24 files), 302 integration tests (36 files), 46 e2e tests (7 files) — all passing.
- **Regression**: the full pre-existing Phase 4/5/6/7/8 test suites (catalog, inventory, order, cart, checkout, payment, refund, webhook) were re-run in full after every relevant change in this phase and pass unmodified — confirmed zero regressions throughout, not just at the end.
- **Concurrency**: catalog, inventory, order, cart-checkout, and payment concurrency suites (39 tests total) were run 5 consecutive times at the end of this phase — 39/39 passing every time, zero flaky failures.

## 13. Performance verification

Measured, not claimed:

- **Query counts** (measured directly against the real Prisma queries the listing/PDP data functions issue): the product listing page's core query (20 items, with brand/category/primary-image/default-variant all joined) is **1 SQL statement**. The PDP's core query (full product, brand, category, all variants, all images, all specifications) is **1 SQL statement**. Neither has an N+1 in its core read. The PDP does make one additional `getAvailableQuantity` call per `ACTIVE` variant (deliberately uncached, real-time stock) — for the common case of 1–3 variants this is 1–3 extra single-row queries, disclosed as an accepted, by-design characteristic (plan §8/§19), not an oversight.
- **Keyset pagination**: confirmed intact — no `OFFSET` anywhere in the extended `listProductsPublic`/`listProductsForAdmin`, verified by code review and by the dedicated `sortBy=featured` pagination-boundary test (`catalog-storefront.test.ts`) proving no duplicate/skipped item across a page break.
- **Cache Components correctness**: confirmed via production build output (§6 above) — every public catalog route is a genuine Partial Prerender with the correct per-tier revalidate/expire window; every session/cart-dependent route is fully dynamic.
- **Client JS footprint**: measured directly from `.next/diagnostics/route-bundle-stats.json` (Turbopack's own bundle-stats output, not an estimate). First Load JS (uncompressed) across storefront routes ranges **718–782 KB**, with the vast majority being the shared framework/runtime baseline (~718 KB present on every route) — the largest page-specific delta is `/products` at +64 KB. 12 of 50 (24%) app/storefront `.tsx` files are Client Components.
- **Production build**: exit code 0, confirmed multiple times throughout this phase (not just once at the end).
- **NOT measured — explicitly disclosed, not fabricated**: LCP, INP, and CLS require a real browser (Lighthouse/Chrome DevTools/WebPageTest), which is unavailable in this headless CLI environment. Per the explicit instruction not to claim performance targets without measurement, these are left as **required future work in an environment with real browser tooling** — not asserted as met.

## 14. Security verification

- No secret/token logging anywhere in the new code (`GUEST_ORDER_TOKEN_SECRET`/`PAYSTACK_SECRET_KEY` are only ever passed as function parameters, never logged) — confirmed by grep.
- No Paystack secret, session secret, or guest-token secret ever reaches a Client Component or the client bundle — only the signed *token* (a bearer credential, not the secret) does, by design.
- No client-authoritative pricing: confirmed by grep across every storefront client-side `fetch` body — none ever sends `priceMinor`/`total`/`subtotal`/`status`.
- No forged payment/order status possible: every status transition still runs through the existing, unmodified Phase 6/8 use-cases and their own guarded state-machine checks; the storefront never writes a status field directly.
- IDOR: the guest-token routes re-verify token validity AND order-guest-ness independently (defense in depth); the authenticated routes are completely unchanged; both are e2e- and integration-tested for cross-user/cross-order/cross-token rejection.
- Guest token boundary: cannot cross order boundaries (tested), rejects on expiry (tested), rejects on tampering (tested, both at the crypto-primitive level and over real HTTP).
- React's default escaping covers all dynamic text; the two `dangerouslySetInnerHTML` usages (the PDP's `Product` and `BreadcrumbList` JSON-LD blocks) both escape `<` (`<`) before injection, closing the "admin-entered content contains a literal `</script>`" injection vector that plain `JSON.stringify` alone does not close.
- Safe Paystack redirect: the only cross-origin navigation is to a URL Paystack's own API response returned, never a client-constructed one.
- Existing authorization is fully intact: the full Phase 3–8 authorization/IDOR test suites pass unmodified.

## 15. Bugs discovered and fixed

1. **`callback_url` was never populated** (a real, disclosed pre-existing gap from Phase 8): `InitializeTransactionParams.callbackUrl` existed as a field since Phase 8 but nothing ever set it, meaning a real Paystack checkout would never have redirected the browser back to this application at all. Fixed in `initialize-payment.ts` — now always includes `orderId`, and additionally `guestToken` for guest orders. Required adding `APP_BASE_URL` to `lib/env.ts` (Paystack requires an absolute URL). Re-verified against the full Phase 8 payment suite (52 tests) with zero regressions.
2. **Base UI's `render` prop vs. Radix's `asChild`**: every initial `asChild` usage (copied from generic shadcn muscle memory) failed to compile against this install's actual Base UI-backed primitives. Fixed across `mobile-nav.tsx`, `site-header.tsx`, `account-nav-area.tsx` before it ever reached a test run.
3. **`ZodEffects` cannot be `.extend()`-ed**: the first version of the extended `listProductsSchema` applied `.superRefine()` before `listProductsForAdminSchema` tried to `.extend()` it, which doesn't type-check. Fixed by restructuring into a shared base object schema + a `withPriceRangeCheck` wrapper applied last, mirroring the file's own pre-existing `withMpptRangeCheck` pattern.
4. **e2e test-isolation bug (session pollution)**: `tests/e2e/storefront.spec.ts`'s shared `createAdminAndProduct` helper left the Playwright request context logged in as the admin it had just created; every subsequent "guest" action in the same test silently became an admin-authenticated action instead (Playwright's `request` fixture shares cookies across all calls within one test). Caught by two failing tests (`cart` was `null` after a "guest" merge; `guestOrderAccessToken` was `undefined` for a "guest" checkout that was actually authenticated). Fixed by having the helper call `POST /api/auth/logout` before returning.
5. **A stale `next start` process masked the new `GUEST_ORDER_TOKEN_SECRET`**: Playwright's `webServer.reuseExistingServer` (true outside CI) reused an already-running server from earlier in this session that predated adding the env var to `.env`, so the guest-token feature appeared broken in e2e even though the underlying code was correct. Not a code bug — a real, disclosed environment-reuse trap; fixed by killing the stale process before each subsequent e2e run.
6. **Pre-existing audit-log cleanup gap (found via this phase's own thorough DB-cleanliness verification, NOT a Phase 9 regression)**: `audit_logs.entity_id` is deliberately not a real FK (`docs/DATABASE_DESIGN.md` §15), so rows with `entityType` `inventory_item`, `order`, or `payment_attempt` are never cleaned up by any existing Phase 5/6/8 test helper (only `entityType: "user"` rows are) — they accumulate indefinitely across every test run that restocks inventory, creates an order, or processes a payment. **Confirmed to predate Phase 9 and to be independent of it**: re-running only the pre-existing `order.spec.ts`/`inventory.spec.ts`/`payment.spec.ts` e2e files in isolation reproduced the identical leftover pattern with zero involvement from any Phase 9 file. This phase's own new test helpers/teardown block introduce no analogous gap of their own. **Not fixed** — retrofitting Phase 5/6/8's own integration-test and e2e cleanup helpers is outside this phase's approved scope (it would mean modifying already-approved Phase 3–8 test infrastructure); the accumulated debris from this session was manually cleared as part of this phase's own final database-cleanliness verification, and is flagged here as a recommended, low-risk, test-infrastructure-only follow-up for a future phase.
7. **Orphaned empty guest carts** (also found via this phase's DB-cleanliness check): a guest cart that has an item added and then removed is left as a real, empty, `ACTIVE` row with no `userId` — invisible to every existing item-matched cart cleanup query (there's nothing left to match through), including this phase's own initial `Phase9E2E` teardown block. **Fixed**, unlike bug 6, because it was directly triggered by this phase's own new test (`tests/e2e/storefront.spec.ts`'s "add, update, remove" test): added a supplementary sweep to `global-teardown.ts` deleting any `userId: null` cart with zero items — safe because this script only ever runs against the e2e test database.

## 16. Deviations from approved plan

- **Billing-address UI is not built** (§18) — the backend's optional `billingAddress` field is unchanged and fully functional; only the checkout form's UI omits a field for it in this pass. A deliberate, disclosed scoping simplification, not a capability regression.
- No other deviation from the approved plan or the approval message's 22 numbered sections occurred.

## 17. Known limitations

- LCP/INP/CLS are unmeasured in this environment (§13) — requires a follow-up with real browser tooling before any performance target can be claimed as met.
- The image-hosting dependency remains unresolved, exactly as flagged in the plan (§18/§28 Q3) — every product image still renders via the isolated `ProductImage` wrapper with `unoptimized` set, since no real object-storage/CDN host is known. No new guess was introduced this phase either.
- Consultation/installation remain static `mailto:`/`tel:` entry points, per the explicit instruction not to build a `ServiceRequest` backend.
- Search remains MySQL `LIKE`-based (unchanged from the plan's own disclosed limitation) — no full-text index, no ranking.
- "In stock only" is not a listing filter and price-ascending/descending sort is not implemented, both explicitly deferred per the approval.
- The pre-existing audit-log cleanup gap (§15 bug 6) remains unfixed, by design, as an out-of-scope-for-Phase-9 finding.

## 18. Unresolved dependencies (carried forward from the plan, unchanged)

- §28 Q1 (guest payment-status access) is now **resolved** — Option A was fully implemented.
- §28 Q2 (real consultation/installation backend) — still open; static CTAs shipped in the meantime.
- §28 Q3 (image hosting/CDN decision) — still open; the isolated `unoptimized` wrapper remains the interim answer.
- §28 Q4/Q5 ("in stock only" filter, price sort) — still deferred, as explicitly approved.

## 19. Final verification matrix

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors |
| ESLint (full repo, boundary rules included) | 0 issues |
| Prettier (`--check .`) | Clean |
| Unit tests | 186/186 passing (24 files) |
| Integration tests | 302/302 passing (36 files) |
| e2e tests | 46/46 passing (7 files) |
| Concurrency suites (catalog, inventory, order, cart-checkout, payment — 39 scenarios) | 39/39 passing, 5 consecutive clean runs |
| Production build (`next build`, raw output) | Exit code 0, confirmed repeatedly through the phase |
| Security scan | Clean — no secret logging, no client-authoritative pricing, IDOR/guest-token boundaries verified, safe JSON-LD injection handling, safe external redirect |
| Database cleanliness (direct query) | 0 leftover users/products/categories/brands/carts/orders/payment_attempts/refunds/webhook_events/inventory rows after the full suite |
| Schema migration | None |
| Phase 3–8 regression | 0 regressions — every pre-existing suite re-run and passing unmodified |

---

**PHASE 9 IMPLEMENTATION COMPLETE — READY FOR REVIEW**

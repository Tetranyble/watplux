# Solar E-Commerce Platform — Phase 0 Architecture

Status: **DRAFT FOR REVIEW — no application code has been written.**
Scope: Architecture, domain model, and engineering strategy only, per the Phase 0 mandate in `AGENTS.md` / `claude-master-instruction.md`.

Runtime baseline actually installed in this repo (verified, not assumed):

| Package | Version |
|---|---|
| next | 16.3.0 |
| react / react-dom | 19.2.8 |
| shadcn (style: `base-nova`) | 4.16.2 |
| tailwindcss | 4.x |

Next.js 16 changes several conventions this plan depends on — confirmed against `node_modules/next/dist/docs/`:

- **`middleware.ts` is deprecated → renamed `proxy.ts`.** Same API, new filename/export. This plan uses `proxy.ts`.
- **Cache Components (`cacheComponents: true` in `next.config.ts`) replace the old `fetch`-cache/`revalidate`/route-segment-config model.** Data fetching is dynamic by default; you opt in per function/component with `"use cache"` + `cacheLife()` + `cacheTag()`. Partial Prerendering (PPR) is the default rendering mode once this flag is on — no separate `experimental_ppr` flag exists anymore.
- Route Handlers under Cache Components render like pages: static unless they touch `cookies()`/`headers()`/uncached I/O, in which case they run at request time or must wrap the I/O in a `"use cache"` helper.

These are load-bearing for the Caching Strategy (§12) and folder structure (§2) below — flagging now so Phase 1 doesn't rediscover them mid-implementation.

---

## 1. Recommended Architecture

Modular monolith inside the Next.js App Router. One deployable, internally layered so business logic never leans on React or HTTP concerns. No separate backend service at MVP — `AGENTS.md` calls for a separate backend only "if there is a strong architectural reason," and there isn't one yet.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Presentation Layer                       │
│  app/**  (Server Components, Client Components, route.ts,        │
│           Server Actions)                                        │
├─────────────────────────────────────────────────────────────────┤
│                      Application / Use-Case Layer                 │
│  src/modules/<domain>/use-cases/*                                 │
│  e.g. checkout.createOrder(), catalog.listProducts(),             │
│       payments.verifyTransaction()                                 │
│  - Orchestrates domain + data access                              │
│  - Owns transaction boundaries                                    │
│  - Never imports React/Next primitives                            │
├─────────────────────────────────────────────────────────────────┤
│         Domain Layer            │        Validation Layer         │
│  src/modules/<domain>/domain/*  │  src/modules/<domain>/schema.ts │
│  - Pure business rules           │  - Zod schemas, single source  │
│  - Order state machine           │    of truth for shape, reused  │
│  - Inventory rules                │    client + server              │
│  - Pricing/discount rules         │                                 │
├─────────────────────────────────────────────────────────────────┤
│      Data Access Layer          │     Integration Layer            │
│  src/modules/<domain>/repo.ts   │  src/integrations/paystack/*     │
│  - Prisma queries only live here│  src/integrations/storage/*      │
│  - No business logic             │  src/integrations/email/*        │
├─────────────────────────────────────────────────────────────────┤
│                        Infrastructure Layer                       │
│  Prisma client, MySQL, object storage client, queue/job runner,   │
│  logger, env/config loader                                        │
└─────────────────────────────────────────────────────────────────┘
```

Rules enforced by folder boundaries (checked in code review, and later by an ESLint import-boundary rule):

- Components call **use-cases**, never `repo.ts` or Prisma directly.
- Use-cases call **repo + integrations**, never `next/*` APIs.
- `domain/*` has zero I/O — it's pure functions/state machines, which is what makes cart totals, discounts, and order-state transitions unit-testable without a database.
- Route Handlers (`route.ts`) exist only for: Paystack webhooks, and any endpoint a non-browser client needs (future mobile app). Everything else uses Server Actions, per Next.js 16's "prefer Server Actions for mutations" guidance — fewer hand-rolled fetch/JSON boundaries, and CSRF-relevant origin checks are handled by the framework.

---

## 2. Folder Structure

```
watplux/
├─ app/
│  ├─ (storefront)/
│  │  ├─ layout.tsx
│  │  ├─ page.tsx                         # home
│  │  ├─ products/
│  │  │  ├─ page.tsx                      # /products (all, paginated)
│  │  │  ├─ [category]/
│  │  │  │  ├─ page.tsx                   # /products/solar-panels
│  │  │  │  └─ [slug]/page.tsx            # /products/solar-panels/450w-mono
│  │  ├─ categories/[slug]/page.tsx
│  │  ├─ services/
│  │  │  ├─ page.tsx
│  │  │  └─ [slug]/page.tsx               # solar-consultation, installation...
│  │  ├─ consultation/page.tsx
│  │  ├─ cart/page.tsx
│  │  ├─ checkout/
│  │  │  ├─ page.tsx
│  │  │  └─ callback/page.tsx             # Paystack browser redirect target (NOT payment proof)
│  │  ├─ account/
│  │  │  ├─ page.tsx
│  │  │  ├─ addresses/page.tsx
│  │  │  └─ orders/
│  │  │     ├─ page.tsx
│  │  │     └─ [orderNumber]/page.tsx
│  │  ├─ sitemap.ts
│  │  └─ robots.ts
│  ├─ (auth)/
│  │  ├─ login/page.tsx
│  │  ├─ register/page.tsx
│  │  └─ forgot-password/page.tsx
│  ├─ admin/
│  │  ├─ layout.tsx                       # server-side RBAC gate lives here
│  │  ├─ page.tsx                         # dashboard
│  │  ├─ products/**
│  │  ├─ categories/**
│  │  ├─ brands/**
│  │  ├─ inventory/**
│  │  ├─ orders/**
│  │  ├─ customers/**
│  │  ├─ payments/**
│  │  ├─ discounts/**
│  │  ├─ consultations/**
│  │  ├─ reviews/**
│  │  ├─ media/**
│  │  ├─ settings/**
│  │  └─ audit-logs/**
│  └─ api/
│     ├─ paystack/
│     │  ├─ webhook/route.ts              # ingest + acknowledge ONLY — no verification/processing here (§6)
│     │  └─ initialize/route.ts (or Server Action — see §6)
│     └─ health/route.ts
├─ src/
│  ├─ modules/
│  │  ├─ catalog/        (products, categories, brands, specs, search)
│  │  ├─ inventory/      (stock items, movements, reservation)
│  │  ├─ cart/
│  │  ├─ checkout/
│  │  ├─ orders/
│  │  ├─ payments/       (Paystack orchestration, payment records)
│  │  ├─ consultations/
│  │  ├─ customers/
│  │  ├─ auth/           (session, RBAC)
│  │  └─ admin/          (audit log, settings)
│  │  └─ <domain>/
│  │     ├─ domain/         # pure logic, state machines
│  │     ├─ use-cases/
│  │     ├─ repo.ts
│  │     ├─ schema.ts       # Zod
│  │     └─ types.ts
│  ├─ integrations/
│  │  ├─ paystack/          # thin typed client; no business logic
│  │  ├─ storage/           # S3-compatible object storage adapter
│  │  └─ email/             # notification boundary (§ Email)
│  ├─ jobs/
│  │  └─ process-webhook-events.ts   # async worker entry point — polls `webhook_events`; invoked by cron (§6, §15)
│  ├─ lib/                  # db client, logger, config, rate-limiter, cn()
│  └─ components/           # shared UI (shadcn lives here per components.json)
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/
├─ proxy.ts                  # Next 16 name for what was middleware.ts — session refresh, admin path gate
└─ tests/
   ├─ unit/
   ├─ integration/
   └─ e2e/
```

Notes:
- Route groups `(storefront)` and `(auth)` share nothing structurally with `admin/` — admin gets its own layout so a bug in storefront rendering can't leak into the admin shell or vice versa.
- `src/modules/*` is framework-agnostic on purpose: if the admin ever needs a CLI script (e.g. bulk stock import), it imports the same use-case the UI calls, instead of a copy-pasted query.

---

## 3. Database ERD / Domain Model

Entity groups (MySQL, InnoDB, utf8mb4). ASCII ERD of the core purchase path — the part with the most correctness risk:

```
brands ───┐
          │
categories│ (self-referencing: parent_id)
   │      │
   └──┬───┘
      ▼
   products ──< product_images
      │    ──< product_specifications  (key/value, structured — see §Solar Specs)
      │    ──< product_variants ──< inventory_items ──< inventory_movements
      │
      ├──< cart_items >── carts ──(nullable user_id, or guest_token)
      │
      └──< order_items >── orders ──< order_status_history
                               │  ──< order_addresses
                               │  ──< payment_attempts ──< refunds
                               │
                               (orders.authoritative_payment_attempt_id → the
                                one SUCCESS attempt, set at most once)

webhook_events   (generic Paystack inbox — every attempt/refund event lands
                  here first; resolved to a payment_attempt or refund only
                  during async processing, so it is NOT a foreign-key child
                  of either at ingestion time — see §6)

users ──< user_roles >── roles ──< role_permissions >── permissions
users ──< addresses
users ──< service_requests   (one table, service_type discriminator — see §11; not
                               separate consultation_requests/installation_requests)
users ──< reviews >── products

settings (typed singleton, §16) + setting_entries (key/value, §16)
audit_logs (actor_id, action, entity, entity_id, diff, created_at)
coupons ──< coupon_redemptions >── orders
```

Key normalization decisions:

- **Variants are universal, not optional — resolved in Phase 2A (`docs/DATABASE_DESIGN.md` §2).** Every product has at least one `product_variants` row; a "simple" product just means a product whose only variant is also its default. `products` carries **no** price/SKU/stock columns at all — that data lives exclusively on `product_variants`, always, closing out the "decided in Phase 2" placeholder this bullet previously left open. See `docs/DATABASE_DESIGN.md` §2 for the full evaluation against cart/inventory/order/pricing/querying, and for the precise database-vs-application split of the "every product has exactly one default variant" invariant (the database enforces *at most one*; *at least one* is a transactional guarantee in the catalog module's use-case layer, not a schema-level fact).
- **Specifications are structured but hybrid**, per the instruction not to create dozens of nullable columns: an EAV-style `product_specifications(product_id, spec_key, spec_value, unit, sort_order)` table holds the long tail (efficiency, cell type, MPPT range, etc.), while fields that are **filtered/sorted/queried directly** get real columns on `products`/`product_variants`:
  - `wattage_w`, `voltage_v`, `capacity_ah_or_kwh`, `phase` — because these back faceted filters and need indexes, and EAV can't be indexed usefully for range queries ("200W–400W panels").
  - Everything else (cycle life, dimensions, warranty text, cell type) lives in `product_specifications` and renders as a spec table on the PDP.
- **Inventory is never a bare column** (see §7).
- **A payment attempt is not the same thing as "the order's payment."** `payment_attempts` is 1:N off `orders` — a failed/abandoned/expired attempt does not consume the order, and a retry creates a *new* attempt row with its own unique `paystack_reference`, never a second `orders` row and never a reused reference. `orders.authoritative_payment_attempt_id` is a nullable pointer set exactly once, the moment (and only if) some attempt reaches `SUCCESS` — this is what "at most one authoritative payment per order" means concretely. `payment_events` from the original draft is replaced by `webhook_events` (see §6): a generic Paystack inbox, not attempt-scoped, because refund events need the same durable-ingestion mechanism and shouldn't require a second, parallel table.
- **Refunds are a distinct entity from payment attempts**, not a status flag on one — a `refunds` row only ever points at an attempt whose `status = SUCCESS`, and its own lifecycle (§10) is independent of that attempt's lifecycle.
- **Orders store snapshots**, not FKs-only references (see §8) — `order_items` duplicates name/SKU/unit price/tax/discount at time of purchase.
- **Soft delete** only on `products`, `categories`, `users` (things referenced by historical orders/reviews that must not disappear from past records). Everything else hard-deletes or relies on status flags (`orders` are never deleted, only status-transitioned).
- **Money as integers.** All currency columns are `INT UNSIGNED` minor units (kobo for NGN), never `FLOAT`/`DECIMAL` floats-in-disguise — matches the Paystack amount contract directly, no unit conversion bugs at the boundary.

---

## 4. Entity Relationships (cardinality summary)

| Relationship | Cardinality | Note |
|---|---|---|
| category → category | 1:N (self) | `parent_id NULL` = root |
| brand → product | 1:N | |
| category → product | 1:N | one primary category per product at MVP; multi-category tagging deferred |
| product → product_variant | 1:N, **at least one always** | never zero rows in practice — a simple product's one variant is also its default (`docs/DATABASE_DESIGN.md` §2) |
| product_variant → inventory_item | 1:1 | inventory tracked per sellable unit, not per product |
| inventory_item → inventory_movement | 1:N | append-only ledger |
| order_item → inventory_movement | 1:N (`RESERVE`, `RELEASE`, `SALE` — at most one each) | a movement identifies the precise commercial line that caused it, not just the order (`docs/DATABASE_DESIGN.md` §5); `RETURN` movements may reference an order item too, without the one-each limit |
| user → cart | 1:1 (0..1), **scoped to `ACTIVE` carts only** | guest carts key on a signed cookie token instead; historical `CONVERTED`/`ABANDONED` carts are not limited to one per user (`docs/DATABASE_DESIGN.md` §6) |
| cart → cart_item → product_variant | 1:N | price snapshot at add-time, revalidated at checkout |
| order → order_item | 1:N, **at most one per variant** | immutable; a variant may appear on at most one line per order (`docs/DATABASE_DESIGN.md` §7) |
| order → payment_attempt | 1:N | each checkout/retry creates a new attempt with its own unique `paystack_reference`; the order has at most one *authoritative* (successful) attempt, pointed to by `orders.authoritative_payment_attempt_id` — see §6 |
| payment_attempt → refund | 1:N | only attempts with `status = SUCCESS` may have refunds; supports partial refunds — a payment attempt tracks *confirmed* (`refunded_amount_minor`) and *in-flight* (`pending_refund_amount_minor`) allocations separately, so the combined total is what's validated against the attempt's paid amount, not confirmed refunds alone (`docs/DATABASE_DESIGN.md` §9) |
| order → refund | 1:N (denormalized) | `refunds.order_id` is stored redundantly for query convenience; always consistent with `refunds.payment_attempt_id → payment_attempts.order_id` |
| webhook_events → (payment_attempt \| refund) | resolved N:1 | generic Paystack inbox (§6); ingestion doesn't know the target row yet, so this is a resolved-at-processing-time relationship, not a foreign key at insert time |
| order → order_status_history | 1:N | append-only audit trail of the state machine |
| user → role (M:N via user_roles) | | supports multiple roles per admin user |
| role → permission (M:N) | | see §11 |
| user → service_request | 1:N, nullable user_id | guests can request consultations/installation/etc.; one table with a `service_type` discriminator, not separate tables (`docs/DATABASE_DESIGN.md` §11) |

---

## 5. Authentication Architecture

**Current runtime (August 2026): Better Auth + application RBAC.** Better Auth is the single owner of identity, credential accounts, session cookies, DB-backed sessions, and verification records. The commerce application continues to own authorization through `roles`, `permissions`, `user_roles`, and `role_permissions`; no commerce module imports Better Auth directly. The seam is `lib/session.ts`, which converts a validated Better Auth session into the existing `AuthenticatedUser` actor plus resolved permission keys. See `docs/BETTER_AUTH_REBUILD.md`.

- Credentials: email/password through Better Auth, with the project's existing Argon2id hash/verify functions configured as Better Auth's password implementation. Password hashes live on Better Auth credential `accounts`, never on `users`.
- IDs: existing numeric `users.id` values are preserved because the entire commerce schema references them. Better Auth uses mixed ID generation: MySQL auto-increment for User and UUID strings for Session/Account/Verification.
- Session storage: Better Auth DB-backed `sessions`, allowing immediate forced logout by deleting sessions for a user. Suspended/deleted application users are rejected both at session creation and again when `lib/session.ts` resolves the application actor.
- Cookies: Better Auth-managed opaque HttpOnly session cookies, `secure` in production, `sameSite=lax`; the cookie prefix is `watplux`.
- `proxy.ts` performs only the cheap Better Auth session-cookie presence redirect for protected route prefixes. It is never the RBAC boundary. Layouts/routes resolve the server session and business use-cases call `requirePermission()` themselves.
- Registration/login storefront Server Actions layer application-specific guest-cart merge behavior after Better Auth succeeds; Better Auth itself does not own Cart behavior.
- Guest checkout remains sessionless. Guest cart and guest-order payment-result credentials remain narrowly scoped application capabilities and are separate from Better Auth sessions.

---

## 6. Payment Architecture (Paystack)

Secret key usage is strictly server-side (`src/integrations/paystack/client.ts`, reads `PAYSTACK_SECRET_KEY` from env, never imported by any Client Component). Public key (if used for any client-side widget) is the only Paystack credential allowed in browser code.

### 6.1 Entities

Four distinct entities, deliberately not collapsed into each other:

| Entity | Purpose | Cardinality |
|---|---|---|
| **Order** | What was purchased, at what price. | 1 per checkout |
| **Payment attempt** (`payment_attempts`) | One customer attempt to pay for an order via Paystack. Has its own unique `paystack_reference`. | N per order |
| **Webhook event** (`webhook_events`) | Raw, durable record of one Paystack callback (charge or refund). The ingestion/idempotency boundary. | N per attempt or refund, resolved async |
| **Refund** (`refunds`) | An admin-initiated reversal of a *successful* payment attempt. Its own async lifecycle. | N per successful attempt |

`payment_attempts(id, order_id, paystack_reference UNIQUE, amount_minor, currency, status, channel, authorization_url, access_code, gateway_response, error_code, error_message, paid_at, failed_at, created_at, updated_at)`.

`error_code`/`error_message` hold sanitized gateway/network failure metadata (Paystack's error code and message, or a local `NETWORK_ERROR`/`TIMEOUT` marker for a failed HTTP call) — never raw request/response bodies, and never anything resembling card data or the secret key. See §10.1 for when these are set.

`orders.authoritative_payment_attempt_id` — nullable FK, set exactly once, only when some attempt for that order transitions to `SUCCESS`. This is the concrete meaning of "an order has at most one authoritative payment": not a 1:1 table relationship, but a single pointer set once by the state machine.

### 6.2 Why attempts are 1:N, not 1:1

A customer can fail payment, abandon the Paystack page, and retry — each retry is a fresh Paystack transaction with a fresh reference, but it's still the same order (same cart contents, same reserved stock, per §7). Forcing 1:1 would mean either blocking retries or fabricating a new order per retry, which would fragment inventory reservations and order history for what is, from the customer's point of view, one purchase. A failed/abandoned attempt is retained (not deleted or overwritten) as a factual record of what happened.

### 6.3 Webhook ingestion vs. processing — corrected architecture

The original draft conflated "acknowledge the webhook" with "verify and act on it" inside one synchronous request. That's wrong for two reasons: a slow Verify-Transaction round trip (or a slow email send) can hold the webhook response open long enough that Paystack times out and retries, and a crash between "act on it" and "return 200" would cause Paystack to retry a webhook whose side effects already partially happened. The corrected flow separates the two:

```
Paystack
   │  POST /api/paystack/webhook
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Route Handler (app/api/paystack/webhook/route.ts)             │
│                                                                 │
│ 1. Read raw request body (bytes, not parsed JSON — needed      │
│    for signature verification)                                 │
│ 2. Verify x-paystack-signature (HMAC-SHA512, constant-time     │
│    compare) → 401 and STOP if invalid, no DB write             │
│ 3. INSERT INTO webhook_events (...) — idempotent, see §6.4      │
│    (this is the ONLY database write in this handler)           │
│ 4. Return HTTP 200                                              │
└─────────────────────────────────────────────────────────────┘
                       │
                       │  (fully durable at this point — see §6.5)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Async worker (src/jobs/process-webhook-events.ts,              │
│ invoked by cron for MVP — see §15)                              │
│                                                                 │
│ 5. Claim a PENDING webhook_events row (atomic compare-and-swap  │
│    to PROCESSING, with a staleness timeout for crash recovery)  │
│ 6. Resolve the row to a payment_attempt or refund by reference/ │
│    transaction id                                               │
│ 7. Call Paystack's Verify Transaction API server-side — never   │
│    trust the webhook payload's amount/status alone              │
│ 8. Transition payment_attempts.status (§10)                     │
│ 9. Transition orders.status through the state machine (§8),     │
│    transactionally with the inventory conversion (§7)           │
│ 10. Transition refunds.status if this event was a refund event  │
│ 11. Enqueue notification side effects (order confirmation,      │
│     admin alert) — a further queued step, not inline, so an     │
│     email-provider outage can't stall webhook processing        │
│ 12. Mark the webhook_events row PROCESSED (or FAILED with a      │
│     backoff for retry, distinct from Paystack-level retries)    │
└─────────────────────────────────────────────────────────────┘
```

The Route Handler never calls Paystack's Verify Transaction API and never touches `orders`/`payment_attempts`/inventory — its entire job is "authenticate and durably record," which is fast and has nothing left to fail slowly.

**Crash safety.** If the process dies immediately after step 4 returns 200, the `webhook_events` row already exists with `processing_status = 'PENDING'` — the next worker poll picks it up. If the worker crashes mid-processing (after claiming, before marking PROCESSED), the row is stuck in `PROCESSING`; a staleness check (`processing_status = 'PROCESSING' AND locked_at < NOW() - INTERVAL 5 MINUTE`) requeues it to `PENDING` for another worker pass. The architecture is correct under "crash right after 200" by construction, per the instruction.

### 6.4 Idempotency — defined from actual Paystack fields, not assumed

Paystack's webhook payload does not include a dedicated webhook-delivery ID (unlike, e.g., Stripe's `evt_...`). What it does document reliably: a top-level `event` string (e.g. `charge.success`, `charge.failed`) and a `data` object carrying Paystack's own numeric transaction id (`data.id`) and the transaction reference we generated (`data.reference`). The idempotency key is built from fields that are actually present:

```
UNIQUE KEY uk_webhook_events (event_type, paystack_transaction_id)
```

`webhook_events(id, event_type, paystack_transaction_id, paystack_reference, raw_payload JSON, received_at, processing_status ENUM('PENDING','PROCESSING','PROCESSED','FAILED'), processing_attempts, locked_at, processed_at, error_message, resolved_entity_type, resolved_entity_id)`.

A second delivery of the same event (same `event_type` + same `paystack_transaction_id`, which Paystack does not change across redelivery attempts) hits the unique constraint on insert; the handler treats that as "already recorded," acknowledges 200, and does nothing further at the ingestion layer. This is flagged as **an assumption to confirm against a captured live payload before Phase 9 implementation** — the shape is Paystack's documented convention, not something this document has verified against a live webhook delivery.

Ingestion-level idempotency alone would still be correct even without it, because processing itself is idempotent by construction (§6.5) — this is deliberate defense in depth, not redundancy for its own sake.

### 6.5 Processing-level idempotency (defense in depth)

Even if the same logical event were somehow processed twice — a manual reprocess, a bug, a future change to the ingestion constraint — the transition itself is a no-op the second time:

```sql
UPDATE orders
SET status = 'PAID', authoritative_payment_attempt_id = :attemptId
WHERE id = :orderId AND status = 'PENDING_PAYMENT'
```

Zero rows affected means the order was already transitioned; the worker skips the inventory conversion and notification steps entirely rather than re-running them. This is what guarantees "same webhook received twice → one payment transition → one order transition → one inventory transition" holds even under a partial failure of the ingestion-level guard.

### 6.6 Signature verification

HMAC-SHA512 of the raw request body using `PAYSTACK_SECRET_KEY`, compared to the `x-paystack-signature` header using constant-time comparison. Requests failing verification are rejected with 401 before any database write — signature verification happens before the `webhook_events` insert, not after.

### 6.7 Retry flow and the browser callback

```
Server                                    Paystack
──────                                    ────────
POST initialize
  - amount (kobo, server-computed)
  - email
  - reference (server-generated, unique per ATTEMPT)
  - metadata { orderId }          ─────►  returns { authorization_url, access_code }
                                            │
Browser redirected to authorization_url ───┘
                                            │
Customer pays (or fails/abandons) ─────────┤
                                            ├──► Webhook POST /api/paystack/webhook
                                            │      (authoritative — §6.3)
                                            └──► Customer redirected to /checkout/callback
                                                   (advisory only — polls order status
                                                    server-side, never marks anything paid)
```

If an attempt ends in `FAILED`/`ABANDONED` and the order is still `PENDING_PAYMENT` (stock still reserved, §7), the order page offers "Retry Payment," which creates a **new** `payment_attempts` row with a fresh reference and re-runs Initialize — it does not touch the existing reservation or create a second order.

This formalizes (and corrects) the flow originally sketched in `paystack-archecture.md`.

---

## 7. Inventory Architecture

Two tables, not one column:

- `inventory_items(id, product_variant_id, quantity_on_hand, quantity_reserved, low_stock_threshold, updated_at)` — `quantity_available` is a derived value (`on_hand - reserved`), never stored as an independently-writable column, so it can't drift out of sync (`docs/DATABASE_DESIGN.md` §5 makes it a `STORED GENERATED` column specifically so it's also cheap to read).
- `inventory_movements(id, inventory_item_id, type, on_hand_delta, reserved_delta, order_item_id, reference_type, reference_id, note, created_by, created_at)` — append-only ledger. `type` ∈ `RESTOCK | RESERVE | RELEASE | SALE | RETURN | ADJUSTMENT` (the original sketch also listed `CANCELLATION`, dropped in `docs/DATABASE_DESIGN.md` §5 for never having a meaning distinct from `RELEASE`). `on_hand_delta`/`reserved_delta` replace a single generic `quantity_delta` — see §5 of the design doc for why splitting them makes every movement type's effect independently replayable.

Every mutation to `inventory_items` happens **only** as a side effect of inserting a `inventory_movements` row inside the same transaction — never a bare `UPDATE inventory_items SET quantity...` from application code. This is what gives "traceability" (the instruction's word) real teeth: any stock number can be reconstructed/audited from the ledger.

### Reservation ownership

A reservation belongs to the **order**, not to any individual payment attempt. This matters directly because of §6: an order can have multiple payment attempts, and re-reserving (or releasing-and-re-reserving) stock on every failed/retried attempt would be both wasteful and racy. **Concretely, this is expressed via `inventory_movements.order_item_id`** (updated from an earlier draft that referenced `reference_type = 'ORDER'` + `reference_id = orders.id`) — `docs/DATABASE_DESIGN.md` §5 found that referencing the order alone was one level less precise than it needed to be, since it couldn't by itself guarantee "one `SALE` per commercial line" without an unstated assumption about variants never repeating within an order. Referencing the specific `order_items` row instead gives that guarantee directly, while still tracing back to the order via `order_items.order_id` — a specific `payment_attempt_id` never appears as the reservation's reference either way.

The full transactional boundary, order-lifecycle-aligned:

| Order event | Inventory action | Transaction boundary |
|---|---|---|
| Order created (`PENDING_PAYMENT`) | `RESERVE` movement, one per line item | Same transaction as `orders` + `order_items` insert (§9 step 5) — reservation and order creation succeed or fail together |
| Payment attempt fails/is abandoned, order stays `PENDING_PAYMENT` | **No inventory action.** Reservation is intentionally left intact — the customer may retry (§6.7) against the same order | N/A |
| A payment attempt reaches `SUCCESS` → order transitions to `PAID` | `SALE` movement (reserved and on-hand both decrement), gated by the same conditional `UPDATE orders ... WHERE status = 'PENDING_PAYMENT'` from §6.5 | Same transaction as the order's `PENDING_PAYMENT → PAID` write, inside the async worker (§6.3 step 9) |
| Order explicitly `CANCELLED` (admin action, or TTL sweep with zero successful attempts) | `RELEASE` movement reverses the `RESERVE` | Same transaction as the `orders.status → CANCELLED` write |
| Order `REFUNDED` after a completed refund (§10) | No further inventory movement at MVP — restocking a returned physical item is a manual `ADJUSTMENT`/`RETURN` movement entered by admin once the item is physically back, not automatic on refund | Separate, admin-triggered |

**Duplicate-processing guard (independent of §6.4/§6.5).** The `SALE` conversion is additionally gated by the conditional order-status `UPDATE` in §6.5 succeeding (`WHERE status = 'PENDING_PAYMENT'` — zero rows affected means already converted, so the `SALE` insert is skipped entirely). This means "duplicate webhook processing cannot double-deduct stock" holds even if both the ingestion-level unique constraint and the worker's claim-lock were somehow bypassed — three independent layers would all have to fail simultaneously for a double deduction to occur.

Race-condition handling at checkout (reservation itself):
- At "create order" time: reserve stock with `UPDATE inventory_items SET quantity_reserved = quantity_reserved + :qty WHERE inventory_item_id = :id AND (quantity_on_hand - quantity_reserved) >= :qty` inside a transaction — the `WHERE` clause is the concurrency guard (atomic compare-and-swap via row lock), not an application-level read-then-write.
- Zero affected rows ⇒ insufficient stock ⇒ abort order creation before Paystack is ever contacted (so before any `payment_attempts` row exists at all).
- On order cancellation or TTL expiry with no successful attempt: `RELEASE` movement reverses the reservation (table above). A scheduled job (the same cron mechanism as §6.3's worker, or a sibling job) cancels orders stuck in `PENDING_PAYMENT` past a TTL (e.g. 30 minutes) with no successful attempt, so abandoned checkouts don't permanently lock stock.
- **Edge case — late webhook after cancellation:** if a `charge.success` event arrives for an attempt whose order has already been TTL-cancelled (stock released, possibly resold), the order state machine (§8) rejects the `PENDING_PAYMENT → PAID` transition from `CANCELLED` and instead flags the attempt for manual reconciliation (logged loudly, surfaced in the admin payments view) rather than silently re-reserving stock that may no longer exist. This is a genuine trade-off, not a solved problem — see §19.

---

## 8. Order Lifecycle

Explicit state machine, not free-form status updates:

```
PENDING_PAYMENT ──► PAID ──► PROCESSING ──► READY_FOR_DISPATCH ──► SHIPPED ──► DELIVERED
       │                        │                    │                │            │
       │                        └────────────────────┴────────────────┴──► REFUNDED (terminal)
       │
       └──► CANCELLED   (from PENDING_PAYMENT, or PAID by admin w/ refund flow)
```

- Transitions are enforced in `src/modules/orders/domain/order-state-machine.ts`: a pure function `nextState(current, event) → newState | Error`. Every place that changes `orders.status` (the async webhook-processing worker, admin action) calls this — never a raw `UPDATE orders SET status = ...`. Note it is the **async worker** (§6.3), not the webhook Route Handler itself, that ever calls this — the handler only ingests.
- `PENDING_PAYMENT → PAID` is the one transition that also sets `orders.authoritative_payment_attempt_id` (§6.1) and triggers the inventory `SALE` conversion (§7), atomically with the status write (§6.5's conditional `UPDATE`).
- **`REFUNDED` is reachable from `PAID`, `PROCESSING`, `SHIPPED`, or `DELIVERED`** — the original draft omitted `DELIVERED`, which contradicted §10.2 (a completed refund can legitimately follow a delivered order, e.g. a warranty/returns-policy refund). Whether a refund is *allowed* to be requested post-delivery is a **business policy decision** (a returns window) enforced in the `payments.refund` use-case before a `refunds` row is even created (§10.2) — the state machine's job is only to permit the transition once a refund actually completes; it does not itself encode the policy window.
- A refund reaching `orders.status = REFUNDED` is a payment-status fact only. It does **not** trigger any automatic inventory movement — restocking a physically returned item stays a separate, manual `RETURN`/`ADJUSTMENT` movement entered by admin once the item is physically back (§7), regardless of which pre-refund state (`PAID` through `DELIVERED`) the order refunded from.
- The state machine explicitly rejects `CANCELLED → PAID` (rather than silently allowing it) — a `charge.success` event arriving after TTL cancellation is a reconciliation case, not a normal transition (§7 edge case, §19 risk).
- Every transition writes an `order_status_history` row (`from_status`, `to_status`, `actor` [`system`/`admin:{userId}`/`webhook`], `note`, `created_at`).
- Order line items (`order_items`) are immutable snapshots at creation time: `product_name`, `sku`, `unit_price_minor`, `quantity`, `discount_minor`, `tax_minor`, `line_total_minor`, plus `product_id`/`variant_id` as informational FKs only (a later product rename/price change/deletion must never alter a historical order).

---

## 9. Checkout Lifecycle

```
1. Client submits cart + customer/delivery info (Server Action)
2. Server: reload cart from DB by cart id/token — ignore any client-sent line items/prices
3. Server: validate stock per line (see §7 reservation)
4. Server: recalculate price per line, discounts, delivery fee, tax → total (server-only math)
5. Server: create `orders` (PENDING_PAYMENT) + `order_items` + reserve inventory (§7) — one transaction
6. Server: create a `payment_attempts` row with a freshly generated unique reference, linked to the order
7. Server: call Paystack Initialize Transaction with the server-computed amount
8. Server: return { authorization_url } to the client for redirect
```

No step in this list accepts a client-supplied amount, discount, or shipping fee — every number that reaches Paystack is recomputed from `products`/`coupons`/settings tables at step 4.

**If step 7 fails** (Paystack rejects the Initialize call, or it never completes — validation/API/network error), the use-case transitions the attempt created in step 6 straight to `INITIALIZATION_FAILED` (§10.1) synchronously, in the same request — there is no webhook to wait for since no chargeable transaction was ever created. The order stays `PENDING_PAYMENT`, its inventory reservation from step 5 is untouched, and the customer sees a checkout error with the option to retry (which re-enters at step 6 with a new attempt).

**Retry path.** If the customer returns to a `PENDING_PAYMENT` order whose most recent attempt is `FAILED`/`ABANDONED`, "Retry Payment" re-enters at step 6 only — it creates a new `payment_attempts` row against the *existing* order and skips steps 1–5 entirely (no re-reservation, no new order), per §6.7/§7.

---

## 10. Payment Attempt & Refund Lifecycle (state view)

### 10.1 Payment attempt (`payment_attempts.status`)

```
INITIATED ──► PENDING ──► SUCCESS
    │                  └► FAILED
    │                  └► ABANDONED   (TTL sweep, no terminal webhook ever arrived for THIS attempt)
    │
    └──────────────────► INITIALIZATION_FAILED   (Paystack Initialize call itself never
                                                    succeeded — PENDING was never reached)
```

- `INITIATED`: set the moment a `payment_attempts` row is created (§9 step 6), before the Initialize API call is even made.
- `INITIATED → PENDING`: set only after Paystack's Initialize Transaction call returns successfully with an `authorization_url`/`access_code` — this is the point a real, chargeable Paystack transaction exists for the customer to pay against.
- `INITIATED → INITIALIZATION_FAILED` (terminal): the Initialize call itself fails — a validation error, a Paystack API error response, or a network/timeout failure reaching Paystack at all. This is deliberately a **distinct terminal state from `FAILED`**, not a reuse of it: `FAILED` means Paystack accepted and processed a charge attempt that the customer or card issuer declined; `INITIALIZATION_FAILED` means no chargeable transaction was ever created at Paystack, so there is nothing to verify, no webhook will ever arrive for this attempt, and it belongs in a different support/analytics bucket (a checkout-flow failure vs. a declined payment). Sanitized `error_code`/`error_message` (§6.1) are recorded on this transition; no card data, request/response bodies, or secrets are logged.
- An attempt reaching `INITIALIZATION_FAILED` does **not** create another order and does **not** touch the inventory reservation — the order remains `PENDING_PAYMENT` with its existing reservation untouched (§7), exactly like a `FAILED`/`ABANDONED` attempt, and "Retry Payment" (§6.7/§9) creates a new `payment_attempts` row the same way.
- `PENDING → SUCCESS`: only via the async worker (§6.3) processing a `charge.success` webhook **after** server-side Verify Transaction confirms `status: success` and `amount` matches the stored `payment_attempts.amount_minor` exactly (defends against a forged webhook claiming success for a lower amount). This is the transition that also sets `orders.authoritative_payment_attempt_id` (§6.1, §8).
- `PENDING → FAILED`: webhook `charge.failed`, or the Verify call itself returns non-success.
- `PENDING → ABANDONED`: scheduled sweep for an attempt past TTL with no terminal webhook — an attempt-level fact, distinct from the order-level TTL cancellation in §7 (an order can have one `ABANDONED` attempt and still be retried with a fresh attempt, as long as the *order's own* TTL hasn't separately expired).
- An attempt's terminal state (`SUCCESS`/`FAILED`/`ABANDONED`/`INITIALIZATION_FAILED`) never changes after the fact — a refund does not reopen or mutate the attempt it refunds; it is recorded against a separate `refunds` row (§10.2).

### 10.2 Refund (`refunds.status`)

> **Updated per `docs/DATABASE_DESIGN.md` §9** — the original version of this section didn't specify *how* a payment attempt's refundable balance was tracked, which allowed an earlier database design draft to get it wrong (incrementing a single `refunded_amount_minor` at *request* time, so a subsequently failed refund left it permanently overstated). The corrected two-ledger allocation model is now the authoritative description; `docs/DATABASE_DESIGN.md` §9 has the full schema and transaction detail.

Refunds are asynchronous by design — accepting a refund *request* is not the same as Paystack having actually completed it, and the architecture must not claim otherwise:

```
REFUND_REQUESTED → REFUND_PENDING → REFUNDED
        │                 │
        │                 ├──────► REFUND_FAILED
        │                 └──────► REFUND_CANCELLED
        ├─────────────────────────► REFUND_FAILED
        └─────────────────────────► REFUND_CANCELLED
```

- `REFUND_REQUESTED`: an admin with `payments.refund` permission initiates a refund against a `SUCCESS` payment attempt. **This is also the moment the requested amount is allocated** — `payment_attempts.pending_refund_amount_minor` increases by the requested amount, checked transactionally against `amount_minor − refunded_amount_minor − pending_refund_amount_minor` (i.e., against everything already confirmed *and* everything else currently in flight, not just confirmed refunds) so two simultaneously-pending partial refunds can never jointly over-allocate. A `refunds` row is created and an `audit_logs` entry written in the same transaction, *before* calling Paystack.
- `REFUND_REQUESTED → REFUND_PENDING`: Paystack's Refund API accepts the request (returns a processing/queued-style acknowledgement). **This is not the final state** — the allocation from the step above is untouched (still pending); `orders.status` is not touched at all.
- `REFUND_REQUESTED`/`REFUND_PENDING` → `REFUND_FAILED`: the Refund API call fails outright, or Paystack's refund webhook reports failure. **Releases the allocation** — `pending_refund_amount_minor` decreases by the refund's amount; `refunded_amount_minor` is untouched.
- `REFUND_REQUESTED`/`REFUND_PENDING` → `REFUND_CANCELLED`: an admin with `payments.refund` deliberately aborts the request before Paystack confirms it either way — a distinct terminal state from `REFUND_FAILED` (gateway/system failure vs. a human decision), kept separate for a clean audit trail. **Releases the allocation identically to `REFUND_FAILED`.**
- `REFUND_PENDING → REFUNDED`: driven by Paystack's refund webhook event(s), ingested through the **same** `webhook_events` mechanism as charge events (§6.3, §6.4) — a refund event is resolved to its `refunds` row instead of a `payment_attempts` row during async processing, but goes through identical signature-verification, durable-ingestion, and claim-based processing. **Moves the allocation from pending to confirmed** — `pending_refund_amount_minor` decreases and `refunded_amount_minor` increases by the same amount, in one transaction.
  > The exact refund webhook event name(s) (e.g. `refund.processed` / `refund.failed`) are assumed from Paystack's documented event catalogue and are **flagged for confirmation against live payload/docs before refund processing is implemented in Phase 9/10** — same caveat as §6.4's idempotency key.
- Only when a refund reaches `REFUNDED` does the order-level effect happen: if the refunded amount equals the attempt's full paid amount, `orders.status → REFUNDED` (state machine, §8); a partial refund records the `refunds` row and its amount without moving the order out of its current status. Both are single transactional writes triggered by the same worker step that marked the refund `REFUNDED` (§6.3 step 10).

---

## 11. Admin Permission Model (RBAC)

- Tables: `roles`, `permissions`, `role_permissions`, `user_roles` — many-to-many both ways, so a user can hold multiple roles (e.g. `support` + `inventory_manager`) and a permission can belong to multiple roles.
- Permissions are fine-grained resource.action strings, exactly as enumerated in the instruction (`products.read`, `orders.update`, `inventory.adjust`, `payments.read`, `settings.manage`, …), not a single `role === 'admin'` check.
- Enforcement is **layered**, both required:
  1. `admin/layout.tsx` (server component) resolves the session server-side and redirects unauthenticated users — coarse gate, "can you even see the admin shell."
  2. Every admin use-case function takes the acting user and calls `requirePermission(user, 'orders.update')` internally, throwing before touching the repo layer if the check fails. This is what actually matters — it means even a route accidentally left unprotected, or a future non-HTTP caller (cron job, script), still can't act without the right permission, because the check lives in the use-case, not the route.
- Seed data for MVP: two roles (`super_admin` — all permissions; `staff` — read-heavy + order/consultation updates, no `settings.manage`/`payments.refund`), expandable without code changes since permissions are data, not enum-coupled `switch` statements.
- All sensitive admin actions (permission changes, refunds, manual order status overrides, manual inventory adjustments, settings changes) write an `audit_logs` row: `actor_id`, `action`, `entity_type`, `entity_id`, `diff` (JSON before/after), `created_at`.

---

## 12. Caching Strategy

Built on Next.js 16 **Cache Components** (`cacheComponents: true` in `next.config.ts`), which is the current model — the old `revalidate`/`fetch`-cache/route-segment-config approach this plan's training data defaults to is superseded here.

| Data | Strategy | Rationale |
|---|---|---|
| Product listing / PDP content | `"use cache"` on the data-fetching function, `cacheLife('hours')`, `cacheTag('products')` / `cacheTag(`product:${slug}`)` | Read-heavy, changes infrequently; tag-based invalidation on admin product edit (`updateTag`) gives instant freshness without a time-based guess |
| Category tree | `"use cache"`, `cacheLife('days')`, `cacheTag('categories')` | Changes rarely |
| Cart, checkout, account, order status | No caching — reads `cookies()`/session, wrapped in `<Suspense>` so it streams instead of blocking the shell; correctness > cache-hit-rate here | Never serve one user's cart/order to another |
| Admin dashboard aggregates | `"use cache"` short profile (`cacheLife('minutes')`) or `unstable_cache` — revenue/order-count queries are expensive aggregates that don't need per-request freshness | Avoids recomputing SUM/COUNT aggregates on every dashboard load |
| Paystack webhook route | No caching (mutating `POST`, framework never caches non-GET) | N/A |
| Static assets / product images | CDN + object storage, long-lived cache headers, content-hashed filenames | Standard |

Notes:
- Every `"use cache"` call site gets an explicit `cacheLife()` — the instruction to avoid surprises from the implicit `default` profile (5 min stale / 15 min revalidate) is followed literally rather than left implicit.
- On-demand invalidation (`updateTag('products')`) fires from the admin product-update use-case, in the same transaction-adjacent step as the DB write — so an admin editing a price sees it reflected storefront-side without waiting on a timer.
- Session-derived content (account pages, "logged in as X" header fragments) is intentionally **not** wrapped in `use cache` — per Next 16 docs, that data is cached per-session client-side automatically when read via `cookies()` behind `<Suspense>`; forcing it into a shared `use cache` scope would leak one user's session-derived render into another's cache entry, since `use cache` cannot read `cookies()`/`headers()` at all (hard compiler error) — a deliberate design safeguard we lean on rather than fight.

---

## 13. Image / Media Strategy

- Phase 14 introduces a reusable `media_assets` library plus storage-provider boundary (`LOCAL` for development, `S3` for S3-compatible production). Binary bytes never live in MySQL.
- New media receives a stable same-origin `/api/media/<uuid>` URL. Catalog rows store this application URL rather than a provider-specific bucket URL, so object-storage migration does not require catalog rewrites.
- Upload path: authorized catalog operator → MIME/size validation → Sharp decode/auto-orient/resize → WebP re-encode (metadata stripped) → provider upload → `media_assets` record. Storage keys are server-generated.
- Product/category/brand forms share the media workflow. Asset deletion is refused while the canonical URL is still referenced by any of those catalog records.
- `next/image` optimizes managed same-origin media. Legacy arbitrary remote URLs remain supported as an explicitly temporary compatibility path.

---

## 14. SEO Strategy

- Server-rendered product/category content by default (Cache Components + PPR means the static shell — including product name, price, description, structured data — is present on first byte; only truly dynamic slices like "live stock count" or personalized recommendations stream in behind `<Suspense>`). No content that matters for indexing depends on client-side JS execution.
- Per-route `generateMetadata` for title/description/OG/canonical, sourced from the same `catalog` module the page uses (no separate "SEO fields" data path to fall out of sync).
- Structured data: `Product` JSON-LD (price, availability, brand, aggregate rating once reviews exist) on PDPs; `BreadcrumbList` on category/product pages.
- `app/(storefront)/sitemap.ts` generates product + category URLs from the DB (paginated sitemap index once product count grows past a single sitemap's practical size); `robots.ts` disallows `/admin`, `/checkout`, `/account`, `/cart`.
- Slugs: human-readable, unique-indexed, immutable once published (or old slug 301-redirected on change) — never a numeric-ID-only URL for a product/category.

---

## 15. Deployment Architecture

- Runtime: immutable Next.js standalone container from the repository `Dockerfile`, Node 22.23.1, unprivileged uid/gid 1001, SIGTERM shutdown, no secrets baked into the image.
- Release migration: a separate `migrator` Docker target runs `prisma migrate deploy` exactly once before web rollout. Migrations never run from web-container startup.
- Build database: because Cache Components can execute server reads during `next build`, image builds use a migrated disposable MySQL database containing no production/customer data; production DB credentials are never supplied to Docker build.
- Database: managed MySQL 8-compatible service with TLS, encryption at rest, automated backups and PITR. Local `docker-compose.yml` MySQL is development-only.
- Media: production `MEDIA_STORAGE_PROVIDER=s3`; S3-compatible object storage with versioning and optional CDN. Catalog-facing stable media URLs remain application-owned.
- Worker: external/native scheduler invokes the authenticated internal webhook-worker endpoint every minute; its backlog health is monitored independently from web liveness.
- Probes: `/api/live` is process liveness and never touches dependencies; `/api/ready` checks MySQL plus production configuration and controls traffic admission.
- Runtime filesystem: root filesystem can be read-only; only `/tmp` and `/app/.next/cache` require ephemeral writable storage.
- Logs: Pino JSON to stdout/stderr with service/environment/version/revision fields and redaction. The hosting platform ships logs and alerts on errors, 5xx, readiness failure and worker backlog.
- Rollback: switch to the previous immutable web image. Database migrations follow expand/contract; never use `prisma migrate reset` or automatic down migrations in production. Destructive-data incidents restore through managed snapshots/PITR.
- CI/release: `.github/workflows/release.yml` repeats the release gate, builds the runner/migrator from the same commit, and publishes immutable GitHub Container Registry images.

---

## 16. Testing Strategy

Matches the instruction's list directly:

| Layer | Tool (proposed) | Covers |
|---|---|---|
| Unit | Vitest | Cart totals, discount math, inventory reservation math, order-total calculation, order state machine transitions (valid + invalid) |
| Integration | Vitest + a real test MySQL DB (dockerized) | Checkout → order creation, Paystack initialize (mocked HTTP), webhook ingestion incl. idempotency (same event delivered twice → one `webhook_events` row, one payment-attempt transition, one order transition, one inventory deduction — §6.4/§6.5/§7), multiple payment attempts against one order (fail → retry → succeed leaves exactly one authoritative attempt), async worker crash-recovery (a `PROCESSING` row past its staleness window is requeued and completes exactly once), durability under "crash immediately after 200" (webhook acknowledged, process killed, worker on restart still processes the row), refund async flow (`REFUND_REQUESTED` → `REFUND_PENDING` → refund webhook → `REFUNDED`, order only flips to `REFUNDED` on the terminal event, never on request acceptance), inventory deduction under concurrent reservation attempts |
| Authorization | Vitest, hitting use-cases directly | Customer cannot call admin use-cases; each permission gate rejects a user lacking that permission and allows one with it |
| E2E | Playwright | Guest checkout happy path, cart → checkout → (mocked) Paystack → order confirmation |

Payment/webhook idempotency tests are treated as release-blocking, not optional, per the instruction ("do not consider the project complete until critical payment/order flows are tested").

---

## 17. Security Strategy

- Zod validation at every trust boundary (Server Action input, Route Handler body, form submission) — one schema per shape, imported by both the form (client-side UX validation) and the Server Action (authoritative validation), never duplicated by hand.
- SQL injection: closed by construction via Prisma parameterized queries; no raw string-interpolated SQL.
- CSRF: Server Actions get Next.js's built-in origin-check protection; the one plain Route Handler that accepts unauthenticated POST (`/api/paystack/webhook`) is protected by signature verification instead of CSRF tokens, which is the correct control for a server-to-server callback.
- Rate limiting: login, registration, consultation form, and checkout initiation endpoints — token-bucket/sliding-window keyed by IP+account, backed by a small Redis instance or DB table at MVP scale.
- Cookies: `httpOnly`, `secure`, `sameSite=lax`, signed session identifiers only (no PII in the cookie payload itself).
- Security headers: CSP (allow-listing Paystack's checkout domain for the redirect flow, self for scripts/styles), `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` in production, set via `next.config.ts` headers or `proxy.ts`.
- File upload validation: MIME allow-list + magic-byte sniffing (not trusting the `Content-Type` header alone) + size cap, server-side, before anything reaches object storage.
- Audit logging: sensitive admin actions only (§11), never logging secrets/passwords/full tokens/card data — Paystack's model keeps card data off this server entirely (hosted checkout page), which removes PCI scope beyond SAQ-A.
- Never-trust-the-client list from the instruction is enforced structurally, not just by convention: price/stock/role/order-status/payment-status all live behind server-only use-cases with no client-writable path.

---

## 18. Performance Strategy

- Server Components by default; `"use client"` only at actual interaction boundaries (add-to-cart button, filter widgets, quantity steppers) — kept as small leaf components so their JS bundle stays minimal.
- Cache Components + PPR (§12) means product/category pages ship a static shell instantly and stream only what's genuinely dynamic.
- No N+1s: catalog listing queries fetch products with their needed relations (`brand`, `primaryImage`, `variantPriceRange`) in one query via Prisma `include`/`select`, not per-row follow-up queries; enforced in code review and caught by integration tests asserting query count where it matters (e.g. product listing page).
- Indexes deliberately chosen per query pattern (§19 risk list flags where this needs validation against real query plans in Phase 2), not applied blanket.
- Pagination: cursor-based on product listings (stable under concurrent inserts, cheap on large offsets) rather than `OFFSET`-based.
- Images: responsive + lazy-loaded (§13).
- No global client-side state library at MVP — cart/account data is server-derived; TanStack Query is reserved for genuinely client-only server-state needs (e.g. live stock-check polling on PDP), per the instruction's "only where actually required."

---

## 19. Major Architectural Risks

1. **Authentication dependency drift.** The runtime now uses Better Auth with the Prisma adapter and a mixed numeric/string ID strategy so existing commerce FKs remain stable. *Mitigation:* pin Better Auth in the lockfile after installation, keep Better Auth confined to `lib/auth.ts`/`lib/session.ts`/the catch-all route, and verify generated schema requirements before every auth-library upgrade.
2. **Cache Components is new (GA in 16.0) and unforgiving about accidental dynamic access.** A stray `cookies()`/`headers()` call inside a `"use cache"` scope is a hard build error, and the failure surfaces as a generic-looking build/type issue if the team isn't watching for it. *Mitigation:* Phase 6 (Storefront UI) budgets time to establish the Suspense/`use cache` boundary pattern once, in one reference page, before repeating it across the catalog.
3. **Inventory race conditions under real concurrency** (flash-sale-style traffic on a popular panel) — the compare-and-swap `UPDATE ... WHERE` pattern (§7) is correct but has not yet been load-tested. *Mitigation:* an integration test explicitly fires concurrent reservation attempts against one row and asserts no oversell, before Phase 5 is considered done.
4. **Webhook delivery is not guaranteed exactly-once or even guaranteed-at-all** by Paystack. The ABANDONED-sweep (§10.1) is the backstop for missed webhooks, but its TTL choice trades off "customer paid but the order was already TTL-cancelled because the webhook was just slow" against "stock stays locked forever." The late-webhook-after-cancellation case (§7 edge case) is the sharp edge of this trade-off: money may have moved on Paystack's side after this system already released the stock. *Mitigation:* keep the order-level TTL generous relative to typical webhook latency, route any `CANCELLED`-order `charge.success` event to a manual-reconciliation queue instead of silently dropping or silently re-accepting it, and log every ABANDONED/reconciliation case loudly so it's investigable, not silent.
5. **Async webhook processing introduces a new failure mode: worker downtime or a stuck `PROCESSING` row.** If the cron-driven worker (§6.3) doesn't run for a while, customers who paid successfully won't see their order flip to `PAID` until it catches up — a latency risk, not a correctness risk, since the webhook itself is durably stored the moment it's acknowledged. *Mitigation:* the staleness-based requeue (§6.3) bounds how long a crashed claim can block a row, and Phase 17 should alert on `webhook_events` rows older than a few minutes still `PENDING`.
6. **Refund webhook event names/payload shape are assumed, not yet verified** (§6.4, §10.2) — Paystack's exact refund event catalogue needs confirming against live docs/payloads before Phase 9/10 implements refund processing, the same way the `charge.*` idempotency key needs confirming.
7. **Solar spec model (hybrid columns + EAV, §3)** risks scope creep if every new product type tempts a new real column. *Mitigation:* a documented threshold (a spec gets a real column only when it's used in a filter or sort, not just displayed) — revisited but not reopened per-product.
8. **Guest cart → registered account linking** is explicitly deferred (§5); if support asks for "merge my guest orders into my new account" before that's designed, it'll be a real feature request, not a bug.

---

## 20. Recommended MVP Scope

In scope for MVP (Phases 1–13 as currently sequenced):

- Storefront: browse, search/filter, PDP, cart, guest + authenticated checkout, Paystack payment, order tracking, consultation request form.
- Admin: products, categories, brands, inventory, orders, payments (read + refund), consultations, basic dashboard, RBAC, audit log for sensitive actions.
- One primary category tree, one currency (NGN), one locale.

Explicitly deferred past MVP (flagged, not silently dropped):

- Solar sizing **calculator engine** — only the domain boundary/interface is built now, per instruction; no scientifically-asserted calculation ships until it's actually validated.
- Coupons/discounts beyond a simple flat/percentage code — advanced rule stacking, if ever needed, is a v2 conversation.
- Multi-currency, multi-locale.
- Product reviews moderation workflow beyond basic approve/reject.
- Guest-to-account order merging (§19.6).
- A standing job queue (cron-based sweep is the MVP substitute, §15).
- Elasticsearch/OpenSearch — MySQL full-text + proper indexes first; revisit only if a real scale problem shows up (instruction is explicit on this).

---

## 21. Phase 1 Scope (Clarified)

Phase 1, when it starts, is **technical foundation only** — no business schema, no business features. This is a deliberate narrowing beyond what §2's folder structure shows (that folder tree is the destination, not what Phase 1 populates).

In scope for Phase 1:

- Next.js 16 application foundation (`cacheComponents: true`, base `next.config.ts`)
- TypeScript configuration (strict mode)
- Tailwind v4 + shadcn `base-nova` confirmed working end-to-end (already scaffolded in this repo)
- Prisma installed and connected to MySQL — a placeholder/health-check model only, not the business schema
- Environment/config validation (a typed, Zod-validated env loader — fail fast on missing secrets)
- Structured logging foundation
- Error-handling foundation (root `error.tsx`, a logging boundary)
- The `src/modules/<domain>` boundary convention established as empty scaffolding + an ESLint import-boundary rule that enforces it (§1's layering rules become lint errors, not just review comments)
- Test infrastructure wired up (Vitest + Playwright runnable, no real test suites yet beyond a smoke test)
- Formatting/linting (ESLint, Prettier or Biome — confirmed against Next 16's `eslint-config-next`)
- Docker development environment (a `docker-compose.yml` for local MySQL, app container)
- A `health` route handler (`app/api/health/route.ts`) — DB connectivity check, nothing business-specific
- Basic CI validation (typecheck, lint, test on push)

Explicitly **not** in Phase 1: `products`, `categories`, `orders`, `payment_attempts`, `webhook_events`, `refunds`, `inventory_items`, `carts`, any admin UI, any auth provider wiring beyond confirming the chosen library boots. Those are Phases 2–12 as already sequenced.

**Runtime note (post-implementation):** Phase 1 was initially implemented against whatever Node version was already active in the dev environment (`22.0.0`), which caused native-dependency/ESM failures in the Vitest 4 toolchain. This was resolved by pinning the project to Node `22.23.1` via `.nvmrc` (§15) rather than downgrading dependencies — Vitest 4 runs cleanly, `npm audit` reports zero vulnerabilities, and no workaround code remains. Anyone picking up this repo should run `nvm use` before anything else.

---

## Open Questions Before Phase 1

These are reasonable-assumption placeholders per the instruction ("if something is ambiguous, make a reasonable engineering assumption and document it") — flagging them here so they're visible rather than buried in code:

1. ~~**Auth library**~~ — **Resolved.** Better Auth is the production authentication/session owner; application RBAC remains separate. See §5 and `docs/BETTER_AUTH_REBUILD.md`.
2. **Object storage provider**: AWS S3 vs. Cloudflare R2 vs. Backblaze B2 — functionally interchangeable behind the `integrations/storage` adapter; picking one is a Phase 17 deployment decision, not an architectural one.
3. ~~**Variant modeling for simple (non-variant) products**~~ — **Resolved in Phase 2A.** Every product gets at least one `product_variant` row, always; `docs/DATABASE_DESIGN.md` §2 has the full evaluation (this was the "always one variant row" option this bullet was already leaning toward, now confirmed against cart/inventory/order/pricing/querying rather than assumed).
4. **NGN-only at MVP** assumed given the business description; confirm before Phase 9 (Paystack currency parameter, minor-unit handling is NGN=kobo specifically).
5. **Paystack webhook idempotency key and refund event names** (§6.4, §10.2): built from Paystack's documented `event` + `data.id` fields, but not yet verified against a captured live payload. Confirm both before Phase 9/10 implement webhook and refund processing.

---

**STOP — Phase 0 deliverable complete. Awaiting "Proceed to Phase 1."**

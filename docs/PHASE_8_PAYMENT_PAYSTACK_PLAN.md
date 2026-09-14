# Phase 8 — Payment / Paystack Architecture Plan

**Status: PLAN ONLY.** No application code, migration, repository, use-case,
API route, webhook handler, Paystack client, or test has been written. This
document is the sole deliverable of this phase.

---

## 1. Executive Summary

The central problem of Phase 8 is not "how do we call Paystack" — it is
**how an external, unreliable payment system coexists safely with the
Order/Inventory/Cart architecture already built in Phases 5–7**, without
ever producing a duplicate sale, a duplicate charge treated as legitimate,
a resurrected cancelled order, or a lost payment event.

The good news, confirmed by grounding directly against the repository
(§2): **the hard part of this problem was already solved, twice, before
Phase 8 started.** Phase 2B built the full `payment_attempts` /
`webhook_events` / `refunds` schema with the two-ledger refund allocation
model and the durable-ingestion/async-processing webhook split already
designed in `docs/ARCHITECTURE.md` §6/§10 and `docs/DATABASE_DESIGN.md`
§8/§9. Phase 6 built `order/repo.ts`'s `markOrderPaid` — an idempotent,
race-safe, inter-module contract that already does exactly steps 7–11 of
this plan's own required successful-payment transaction (§6.1), composing
Inventory's `completeSaleInTransaction` internally. Phase 7 built
`checkout/repo.ts`'s `createInitialPaymentAttempt`, creating the first
`payment_attempts` row (`status: INITIATED`) as a plain, non-transactional
insert immediately after checkout's own transaction commits, and stopped
there by design — "Phase 8 begins exactly at 'take this `INITIATED` row
and actually call Paystack Initialize.'"

**Phase 8's actual job, then, is narrower than "build a payment system"**:
add a thin `src/integrations/paystack/` client; add one small `payment`
module that (a) drives `INITIATED -> PENDING/INITIALIZATION_FAILED` via
Paystack's Initialize API, (b) durably ingests webhooks with zero business
logic, (c) an async worker that verifies-then-acts on those webhooks by
calling into the *already-built* `markOrderPaid` contract (extended with
one additive, tx-composable primitive — the same "Option A" pattern Phase
6/7 already used twice), and (d) drives the already-designed refund
allocate/confirm/release lifecycle. **No schema change is required
anywhere in this plan** (§32).

Three genuine gaps were found during grounding, none requiring a schema
change or a redesign — all resolved below, disclosed as findings rather
than silently patched: (1) the `payment_attempts.status` enum's lack of a
distinct "successful but non-authoritative" state is not a gap — it's
solved by comparison against `orders.authoritative_payment_attempt_id`,
never by a new enum value (§11); (2) Phase 7's placeholder
`CHKOUT-<base64url>` reference format is not guaranteed Paystack-safe
(base64url includes `_`, which Paystack's documented reference character
set — alphanumeric, `-`, `.`, `=` — does not) and must be regenerated with
a Paystack-safe alphabet before this reference is ever sent externally
(§8); (3) Paystack's webhook payload does not carry a dedicated
webhook-delivery ID, and whether `data.id` is reliably present and
non-null for every event type this system needs to handle is an open,
disclosed risk already flagged (unresolved) in both `ARCHITECTURE.md` §6.4
and `DATABASE_DESIGN.md` — this plan proposes a concrete interim
resolution and carries the verification requirement forward explicitly
(§13/§34) rather than silently assuming it away.

---

## 2. Grounding / Current Repository State

Read in full before writing this plan: `docs/ARCHITECTURE.md` (§1, §6–§11,
§15–§17, Open Questions, Risks), `docs/DATABASE_DESIGN.md` (§0, §8, §9,
§21), `docs/PHASE_2B_REPORT.md` (§B, §D, §E, §F, §G), `docs/PHASE_6_ORDER_IMPLEMENTATION.md`,
`docs/PHASE_7_CART_CHECKOUT_PLAN.md`, `docs/PHASE_7_CART_CHECKOUT_IMPLEMENTATION.md`,
`prisma/schema.prisma` (Payments domain models in full), `src/modules/order/repo.ts`,
`src/modules/order/domain/order-state-machine.ts`, `src/modules/inventory/repo.ts`,
`src/modules/checkout/repo.ts`, `src/modules/cart/**`, `src/modules/auth/**`,
`src/integrations/**`, `lib/errors.ts`, `lib/logger.ts`, `lib/env.ts`,
`prisma/seed-data.ts`, `eslint.config.mjs`, `tests/integration/order-concurrency.test.ts`,
`package.json`.

Confirmed facts that ground every decision below:

- **No Paystack code exists anywhere in the repository.** `src/integrations/`
  contains only `crypto/password.ts`, `crypto/tokens.ts`,
  `notifications/token-delivery.ts`, and a `README.md` that already names
  the planned location: `src/integrations/paystack/client.ts` (per
  `ARCHITECTURE.md` §6) and states "Paystack in Phase 9" (the
  architecture document's own internal phase numbering predates this
  project's actual phase sequence — Phases 2B/3–7 already diverged from
  that original numbering; this plan treats "Phase 8" as the phase that
  fulfills what `ARCHITECTURE.md` calls "Phase 9/10").
- **No `src/modules/payment/` (or `payments/`) directory exists.** Existing
  modules: `auth`, `cart`, `catalog`, `checkout`, `health`, `inventory`,
  `order` — every one of them singular, despite `ARCHITECTURE.md` §2's own
  illustrative sketch using `src/modules/payments/` (plural). Order's own
  plan explicitly deviated from `ARCHITECTURE.md`'s plural sketch for this
  exact reason (`order-state-machine.ts`'s own doc comment). This plan
  adopts the identical, already-established convention: **`src/modules/payment/`**
  (singular), not `payments/`.
- **`src/jobs/` exists but is empty** (`README.md` only), already stating
  the exact planned file — `process-webhook-events.ts` — and already
  registered as its own ESLint `boundaries/elements` type (`job`, pattern
  `src/jobs/**`), with a dependency rule already in force: *"Jobs
  orchestrate through use-cases only — they cannot import a repo,
  presentation, component, or domain module directly."*
- **The full Payments-domain schema already exists**, migrated in Phase 2B
  (`20260808140413_payments_domain`), with the circular
  `orders.authoritative_payment_attempt_id <-> payment_attempts.id` FK
  fully closed both directions, the two-ledger refund-allocation CHECK
  constraint (`chk_payment_attempts_refund_allocation`) in place, and the
  webhook natural-key unique index (`uq_webhook_events_natural_key` on
  `(event_type, paystack_transaction_id)`) in place. See §3 for the exact
  fields.
- **`order/repo.ts`'s `markOrderPaid`/`requireMatchingPaymentAttempt`
  already exist**, fully idempotent and race-safe (§6). **Inventory's
  `completeSaleInTransaction` already exists** and is already composed
  inside `markOrderPaid`. Neither needs new business logic — `markOrderPaid`
  needs exactly one additive, tx-composable sibling (`markOrderPaidInTransaction`),
  mirroring Phase 6/7's own established "Option A" pattern for
  `createOrderInTransaction` (§6, §26).
- **`order-state-machine.ts` already encodes every transition this phase
  needs**: `PENDING_PAYMENT -> PAID` (`PAY`), `PAID -> CANCELLED` (`CANCEL`,
  "intentionally present... depends on Refund/Paystack machinery this
  phase excludes" — i.e., reserved for this phase), `PAID/PROCESSING/READY_FOR_DISPATCH/SHIPPED/DELIVERED -> REFUNDED`
  (`REFUND`). `CANCELLED` has **zero** outgoing transitions — `CANCELLED -> PAID`
  is structurally impossible via any event, confirmed directly in the
  transition table, not assumed. No change to this file is needed or
  proposed.
- **RBAC already seeds exactly two payments-relevant permissions**:
  `payments.read` and `payments.refund` (`prisma/seed-data.ts`). `staff`
  holds `payments.read` but not `payments.refund`; `super_admin` holds
  both. **No new permission key is required** (§22).
- **`lib/logger.ts`'s redaction config already includes `"*.paystackSecretKey"`**
  — pre-wired ahead of any Paystack code existing, confirming the naming
  convention this plan's Paystack client config object must use for its
  secret-key field to get automatic redaction for free.
- **`lib/env.ts` has no Paystack environment variables yet** — `PAYSTACK_SECRET_KEY`
  (and the handful of small config values in §8/§14) must be added to its
  Zod schema when Phase 8 is implemented (not done in this plan).
- **No HTTP client, queue, or cron library is a dependency.** Native
  `fetch` (Node 22's built-in) is the only consistent-with-existing-deps
  choice for the Paystack client; no queue library is proposed (§30).
- **Integration test conventions confirmed unchanged**: real MySQL
  (`tests/integration/setup.ts` seeds RBAC then runs against the real
  database), `Promise.allSettled`-based concurrency tests asserting fresh
  DB state (`order-concurrency.test.ts`'s cancel-vs-pay race, `[3+4/7]`, is
  the direct template for this phase's webhook-vs-cancel race test),
  cleanup-by-prefix fixtures.

---

## 3. Existing Payment Schema

Verbatim from `prisma/schema.prisma` (Payments domain), unchanged by this
plan:

```prisma
enum PaymentAttemptStatus {
  INITIATED
  PENDING
  SUCCESS
  FAILED
  ABANDONED
  INITIALIZATION_FAILED
}

model PaymentAttempt {
  id                BigInt               @id @default(autoincrement())
  orderId           BigInt               @map("order_id")
  paystackReference String               @unique @map("paystack_reference") @db.VarChar(100)
  amountMinor       Int                  @map("amount_minor") @db.UnsignedInt
  currency          String               @default("NGN") @db.Char(3)
  status            PaymentAttemptStatus
  channel           String?              @db.VarChar(30)
  authorizationUrl  String?              @map("authorization_url") @db.VarChar(500)
  accessCode        String?              @map("access_code") @db.VarChar(100)
  gatewayResponse   String?              @map("gateway_response") @db.VarChar(255)
  errorCode         String?              @map("error_code") @db.VarChar(50)
  errorMessage      String?              @map("error_message") @db.VarChar(500)

  refundedAmountMinor            Int  @default(0) @map("refunded_amount_minor") @db.UnsignedInt
  pendingRefundAmountMinor       Int  @default(0) @map("pending_refund_amount_minor") @db.UnsignedInt
  availableRefundableAmountMinor Int? @map("available_refundable_amount_minor") // GENERATED, STORED

  paidAt    DateTime?
  failedAt  DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  order   Order    @relation("OrderPaymentAttempts", fields: [orderId], references: [id], onDelete: Restrict)
  refunds Refund[]
  resolvedWebhookEvents WebhookEvent[]
}
```

```prisma
enum WebhookProcessingStatus { PENDING PROCESSING PROCESSED FAILED }

model WebhookEvent {
  id                    BigInt                  @id @default(autoincrement())
  provider              String                  @default("paystack") @db.VarChar(20)
  eventType             String                  @map("event_type") @db.VarChar(50)
  paystackTransactionId String                  @map("paystack_transaction_id") @db.VarChar(50)
  paystackReference     String?                 @map("paystack_reference") @db.VarChar(100)
  rawPayload            Json                    @map("raw_payload")
  processingStatus      WebhookProcessingStatus @default(PENDING) @map("processing_status")
  processingAttempts    Int                     @default(0) @map("processing_attempts") @db.UnsignedSmallInt
  lockedAt              DateTime?               @map("locked_at")
  processedAt           DateTime?               @map("processed_at")
  errorMessage          String?                 @map("error_message") @db.Text

  resolvedPaymentAttemptId BigInt? @map("resolved_payment_attempt_id")
  resolvedRefundId         BigInt? @map("resolved_refund_id")

  receivedAt DateTime @default(now()) @map("received_at")
  createdAt  DateTime @default(now()) @map("created_at")

  @@unique([eventType, paystackTransactionId], map: "uq_webhook_events_natural_key")
  @@index([processingStatus, lockedAt], map: "idx_webhook_events_claim")
  @@index([paystackReference], map: "idx_webhook_events_reference")
}
```

```prisma
enum RefundStatus { REFUND_REQUESTED REFUND_PENDING REFUNDED REFUND_FAILED REFUND_CANCELLED }

model Refund {
  id                      BigInt       @id @default(autoincrement())
  paymentAttemptId        BigInt       @map("payment_attempt_id")
  orderId                 BigInt       @map("order_id")
  paystackRefundReference String?      @unique @map("paystack_refund_reference") @db.VarChar(100)
  amountMinor             Int          @map("amount_minor") @db.UnsignedInt
  status                  RefundStatus
  reason                  String?      @db.Text
  requestedBy             BigInt       @map("requested_by")
  requestedAt             DateTime     @default(now())
  processedAt             DateTime?
  rawWebhookPayload       Json?        @map("raw_webhook_payload")
  createdAt               DateTime     @default(now())
  updatedAt               DateTime     @updatedAt

  paymentAttempt  PaymentAttempt @relation(fields: [paymentAttemptId], references: [id], onDelete: Restrict)
  order           Order          @relation(fields: [orderId], references: [id], onDelete: Restrict)
  requestedByUser User           @relation(fields: [requestedBy], references: [id], onDelete: Restrict)
  webhookEvents   WebhookEvent[]

  @@index([status])
}
```

And on `Order` (unchanged): `authoritativePaymentAttemptId BigInt? @unique(map: "uq_orders_authoritative_payment_attempt")`,
FK `ON DELETE RESTRICT`, set at most once by a conditional `UPDATE`.

**Every field this plan needs already exists.** See §32 for the exhaustive
sufficiency review.

---

## 4. Payment Attempt Model

### Why 1:N, not 1:1 (per `ARCHITECTURE.md` §6.2, adopted verbatim)

A customer can fail payment, abandon the Paystack page, and retry — each
retry is a fresh Paystack transaction with a fresh reference, but the same
order (same reserved stock, per Phase 5/6). Forcing 1:1 would mean either
blocking retries or fabricating a new order per retry, fragmenting
inventory reservations and order history for what is, from the customer's
point of view, one purchase.

- **Why retries create a new attempt, not a new order**: the order and its
  inventory reservation belong to the *order*, not to any attempt (§16/§17
  restate this precisely). A failed/abandoned attempt is retained — never
  deleted or overwritten — as a factual record.
- **Why a failed attempt does not create a new Order**: `completeCheckout`
  (Phase 7, unchanged) is the *only* place an `orders` row is created;
  nothing in this phase's retry/failure handling ever calls it again.
  "Retry Payment" re-enters at "create a new `payment_attempts` row" only
  (§10).
- **Why an attempt belongs to exactly one Order**: `payment_attempts.orderId`
  is a plain, immutable `NOT NULL` FK, set once at creation, never updated
  — enforced structurally, not by convention.
- **Why an attempt's Paystack reference must be unique**: `paystackReference`
  is `@unique` — this is what makes "verify by reference" and "resolve a
  webhook to exactly one local attempt" both unambiguous; two attempts
  can never share a reference by construction.
- **What makes an attempt authoritative**: `orders.authoritativePaymentAttemptId === attempt.id`.
  Nothing else — not the attempt's own `status` field, which stays `SUCCESS`
  regardless of whether it ended up authoritative (§11).
- **How an attempt becomes authoritative**: exactly once, via the guarded
  `UPDATE orders SET status = 'PAID', authoritative_payment_attempt_id = :id WHERE id = :orderId AND status = 'PENDING_PAYMENT'`
  inside `markOrderPaid` (§6) — the *first* attempt whose success-processing
  reaches this statement while the order is still `PENDING_PAYMENT` wins,
  structurally, not by application-level locking alone.
- **What happens if two attempts both appear successful, and how the
  non-authoritative one is detected/reconciled**: §11.

---

## 5. Payment Attempt State Machine

Exact states from the actual enum — no invented states:

```
INITIATED ──► PENDING ──► SUCCESS
    │                  └► FAILED
    │                  └► ABANDONED        (TTL sweep; no terminal webhook ever arrived)
    │
    └───────────────────► INITIALIZATION_FAILED   (Initialize API call itself never succeeded)
```

| Current state | Trigger | Required verification | Next state | Order effect | Inventory effect |
|---|---|---|---|---|---|
| *(none)* | Checkout commits (Phase 7, unchanged) | none | `INITIATED` | None (order already `PENDING_PAYMENT`) | None (already reserved by checkout) |
| `INITIATED` | `initializePayment` use-case calls Paystack Initialize Transaction, receives `authorization_url`/`access_code` | Paystack API call itself succeeds (HTTP 2xx, well-formed response) | `PENDING` | None | None |
| `INITIATED` | Paystack Initialize call fails (validation error, Paystack API error, network/timeout) | N/A — this transition *is* the failure | `INITIALIZATION_FAILED` (terminal) | None — order stays `PENDING_PAYMENT`, reservation untouched | None |
| `PENDING` | Webhook `charge.success` claimed by worker | Signature verified (ingestion) + **Paystack Verify Transaction re-called server-side** + `data.status === "success"` + amount match + currency match (§9) | `SUCCESS` | `PENDING_PAYMENT -> PAID` (via `markOrderPaid`, §6) if the order is still `PENDING_PAYMENT`; otherwise no order change (§11/§17) | `RESERVE -> SALE` per line, only if the order transitioned |
| `PENDING` | Webhook `charge.failed`, or Verify Transaction itself returns non-success | Signature verified + Verify Transaction confirms failure (never trust the webhook payload's status alone) | `FAILED` (terminal) | None — order stays `PENDING_PAYMENT`, reservation untouched | None |
| `PENDING` | TTL sweep (no terminal webhook ever arrived within the configured window) | none (background sweep) | `ABANDONED` (terminal) | None | None |
| `SUCCESS` | *(any event)* | — | **rejected, always** | — | — |
| `FAILED` | *(any event)* | — | **rejected, always** | — | — |
| `ABANDONED` | *(any event)* | — | **rejected, always** | — | — |
| `INITIALIZATION_FAILED` | *(any event)* | — | **rejected, always** | — | — |

**Every terminal state is permanently terminal — there is no
`FAILED -> SUCCESS`, no `ABANDONED -> SUCCESS`, no `INITIALIZATION_FAILED -> SUCCESS`,
no `CANCELLED -> SUCCESS`-equivalent for attempts.** This is enforced the
same way every other guarded transition in this codebase is enforced: a
conditional `UPDATE payment_attempts SET status = 'SUCCESS' WHERE id = :id AND status = 'PENDING'`
— any row not currently `PENDING` simply does not match the `WHERE`
clause, `count = 0`, and the caller's idempotency-recheck path runs
instead of the transition (§6, §15).

`INITIATED -> INITIALIZATION_FAILED` is deliberately a **distinct terminal
state from `FAILED`**: `FAILED` means Paystack accepted and processed a
charge attempt the customer/issuer declined; `INITIALIZATION_FAILED` means
no chargeable transaction was ever created at Paystack, so no webhook will
ever arrive for this attempt. Collapsing them would blur "checkout-flow
failure" and "declined payment" into one analytics/support bucket that
answers a different operational question.

---

## 6. Order/Payment Interaction

### 6.1 The atomic successful-payment transaction, mapped onto existing code

The eleven required steps, mapped onto what already exists vs. what this
phase adds:

| Step | Mechanism | Status |
|---|---|---|
| 1. Verify the payment attempt belongs to the Order | `requireMatchingPaymentAttempt(orderId, paymentAttemptId)` | **Exists** (`order/repo.ts`) |
| 2. Verify the attempt is eligible for success | `payment_attempts.status === 'PENDING'` check, enforced by the guarded UPDATE in step 6 below | **New** (payment module) |
| 3. Verify the Paystack transaction/reference | Server-side call to Paystack's Verify Transaction API against `payment_attempts.paystackReference` | **New** (§9) |
| 4. Verify the amount | `verifyResponse.data.amount === payment_attempts.amountMinor` | **New** (§9) |
| 5. Verify currency | `verifyResponse.data.currency === payment_attempts.currency` | **New** (§9) |
| 6. Verify the payment status | `verifyResponse.data.status === "success"` | **New** (§9) |
| 7. Mark the attempt `SUCCESS` | Guarded `UPDATE payment_attempts SET status='SUCCESS', ... WHERE id=:id AND status='PENDING'` | **New** (payment module, §15) |
| 8. Set `orders.authoritative_payment_attempt_id` | Inside `markOrderPaid`'s existing guarded `UPDATE` | **Exists** (`order/repo.ts`) |
| 9. Transition the Order to `PAID` | Same guarded `UPDATE`, `WHERE status = 'PENDING_PAYMENT'` | **Exists** |
| 10. Convert inventory reservation into `SALE` | `inventoryRepo.completeSaleInTransaction`, already composed inside `markOrderPaid` | **Exists** |
| 11. Record the Order history/audit event | `orderStatusHistory` insert (`actorType: "WEBHOOK"`, already a recognized value), already inside `markOrderPaid` | **Exists** |

Steps 3–6 (the external Paystack call and its verification) happen
**strictly outside any database transaction** — see §25/§26 for the exact
boundary. Steps 7–11 happen inside **one** database transaction, which
this plan composes from the *existing* `markOrderPaid` primitive plus one
new, additive step.

### 6.2 The required additive extension to `order/repo.ts`

`markOrderPaid` as it exists today unconditionally opens and owns its own
`db.$transaction`. Calling it from inside a new payment-module transaction
that also needs to mark the *attempt* `SUCCESS` atomically would open two
separate transactions for what must commit or roll back together — **the
exact class of problem Phase 6 solved for Order↔Inventory and Phase 7
solved for Checkout↔Order↔Inventory, one level higher again.**

The required, additive (never subtractive) fix, mirroring
`createOrderInTransaction`'s exact shape:

```ts
// order/repo.ts — additive, mirrors createOrderInTransaction (Phase 7 §17)
export async function markOrderPaidInTransaction(
  tx: Prisma.TransactionClient,
  data: MarkOrderPaidData,
): Promise<MarkOrderPaidRepoResult> {
  // exactly the body markOrderPaid's own db.$transaction callback has
  // today — requireMatchingPaymentAttempt's ownership check still runs
  // via `db` before this is called (immutable value, see §6 comment in
  // order/repo.ts), never via `tx`.
}

export async function markOrderPaid(data: MarkOrderPaidData) {
  await requireMatchingPaymentAttempt(data.orderId, data.paymentAttemptId);
  return db.$transaction((tx) => markOrderPaidInTransaction(tx, data));
}
```

Zero observable behavior change to `markOrderPaid`'s existing signature,
return type, or any existing Phase 6 test's expectations — the same
discipline Phase 6 applied to Inventory and Phase 7 applied to Order:
**re-run Order's entire existing test suite immediately after this
addition, before any Payment code exists, as the first implementation
step** (§35).

### 6.3 The composed payment-success transaction (new, in `payment/repo.ts`)

```
BEGIN (payment/repo.ts's own db.$transaction)
  UPDATE payment_attempts SET status='SUCCESS', gateway_response=?, channel=?, paid_at=NOW()
    WHERE id = :attemptId AND status = 'PENDING'          ← first statement, no snapshot-poisoning risk
  IF count = 0:
    re-check current attempt status via `db` (not `tx`) — already SUCCESS is an idempotent
    no-op (return existing result); any other status is a genuine conflict, abort
  orderRepo.markOrderPaidInTransaction(tx, { orderId, paymentAttemptId })   ← additive, §6.2
    — internally: guarded UPDATE orders ... WHERE status='PENDING_PAYMENT',
      completeSaleInTransaction per line if transitioned, orderStatusHistory insert
  IF NOT result.transitioned AND result.order.status = 'CANCELLED':
    write an audit_logs / reconciliation-flag entry (§17, §23) — the payment succeeded
    but the order cannot be resurrected; this is a NEW step this plan adds, entirely
    inside the payment module, requiring zero change to order/repo.ts's own contract
COMMIT
```

This is the transaction that answers §11 and §17 identically: whether the
non-authoritative `SUCCESS` came from a genuine double-payment or from a
late webhook after cancellation, the *mechanism* is the same guarded
`UPDATE ... WHERE status = 'PENDING_PAYMENT'` in `markOrderPaidInTransaction`
— it structurally cannot resurrect a `CANCELLED` order or re-transition an
already-`PAID` one, and the caller (this new transaction) always knows
from `result.transitioned` whether it won, and can react identically
regardless of *why* it lost.

---

## 7. Paystack Integration Boundary

`src/integrations/paystack/` — thin, typed, no business logic, matching
every existing integration file's shape (`crypto/tokens.ts`,
`crypto/password.ts`: plain exported async functions, never a class):

```
src/integrations/paystack/
  client.ts       — initializeTransaction(), verifyTransaction(), createRefund()
  signature.ts    — verifyWebhookSignature(rawBody, signatureHeader)
  types.ts        — PaystackTransactionData, PaystackRefundData, etc. (typed responses)
```

- Reads `PAYSTACK_SECRET_KEY` from `env` (to be added to `lib/env.ts`'s
  Zod schema) — never imported by any Client Component, never logged
  (`lib/logger.ts` already redacts `*.paystackSecretKey`).
- Uses native `fetch` — no new HTTP-client dependency. No package
  installation is proposed anywhere in this plan.
- Every function returns a typed, narrow result or throws a generic
  `Error` (or a small `PaystackApiError` the *payment module's own
  `domain/`* layer defines, per `lib/errors.ts`'s own explicit statement
  that business-specific error subclasses "belong to their owning
  module's `domain/` layer" — never added to `lib/errors.ts` itself).
- **Never** makes a decision about order/payment/inventory state — it
  only calls Paystack and returns what Paystack said. All interpretation
  (is this amount right, is this status success) happens in the payment
  module's use-cases (§9).
- ESLint boundary: `integration` elements are already disallowed from
  importing `repo`/`use-case`/`presentation`/`component`/`domain`/`job` —
  this client will do none of those; it is a pure leaf dependency, called
  *by* the payment module's use-cases, never the reverse.

**Our database truth vs. Paystack's external truth** — the single rule
this entire plan enforces: **Paystack's webhook payload is a hint that
something may have happened; Paystack's Verify Transaction API response,
fetched by us, server-side, on demand, is the only external fact this
system ever acts on.** A webhook is never sufficient by itself to change
`payment_attempts`/`orders`/inventory state (§9, §12).

---

## 8. Paystack Initialization

### 8.1 Flow

```
INITIATED (Phase 7, already created)
    ↓
new payment/use-cases/initialize-payment.ts:
    - guarded pre-check: attempt.status must be 'INITIATED' (idempotency, §8.3)
    - paystackClient.initializeTransaction({ amount, email, reference, callback_url, metadata: { orderId } })
    ↓ (success)                              ↓ (failure/timeout)
UPDATE payment_attempts SET               UPDATE payment_attempts SET
  status='PENDING',                         status='INITIALIZATION_FAILED',
  authorization_url=?, access_code=?        error_code=?, error_message=? (sanitized)
  WHERE id=:id AND status='INITIATED'       WHERE id=:id AND status='INITIATED'
```

Both branches are plain, single-row guarded `UPDATE`s — no transaction is
needed (single statement, single row, no cross-table write). The Paystack
API call itself happens **before** either `UPDATE`, entirely outside any
database transaction (there is none to be inside of here).

### 8.2 Existing schema fields used (no new field needed)

`paystackReference` (already stored, set at attempt creation),
`authorizationUrl`, `accessCode`, `channel` (populated later, from Verify,
§9), `gatewayResponse`, `errorCode`, `errorMessage`, `paidAt`/`failedAt`
(set later). **Every field this flow needs already exists** — confirmed
directly against the schema in §3, not assumed.

**One field this plan deliberately does *not* add**: a `metadata` JSON
column on `payment_attempts`. Paystack's Initialize API accepts an
optional `metadata` object (used here to carry `{ orderId }` for
cross-referencing on Paystack's own dashboard) — this is sent *to*
Paystack, not persisted locally, because `orders.id` is already
recoverable from `payment_attempts.orderId` without needing a round-trip
copy. No schema change.

### 8.3 The reference-format finding (disclosed, not silently patched)

Paystack's documented reference constraint: only alphanumeric characters
plus `-`, `.`, `=` are allowed. Phase 7's `createInitialPaymentAttempt`
generates `` `CHKOUT-${generateRawToken()}` ``, and `generateRawToken()`
is `randomBytes(32).toString("base64url")` — base64url's alphabet
includes `_`, which is **not** in Paystack's allowed set. Phase 7 never
sent this reference to Paystack (explicitly out of scope), so this was
never exercised against a real constraint until now.

**Resolution — no schema change, no `payment_attempts.paystack_reference`
column-width issue (still `VarChar(100)`, plenty of room)**: this phase
introduces its own reference-generation helper using a Paystack-safe
alphabet:

```ts
// src/integrations/paystack/reference.ts (or payment/repo.ts)
function generatePaystackSafeReference(prefix: string): string {
  return `${prefix}-${randomBytes(20).toString("hex")}`; // hex: 0-9a-f only
}
```

Used for every reference this phase generates (the initial attempt's
reference was already created in Phase 7 using the old format — **this
phase must decide, at `initializePayment` time, whether to send the
already-stored `paystackReference` as-is or regenerate it before the
first-ever Paystack call**). Recommendation: regenerate and overwrite
`payment_attempts.paystackReference` with a Paystack-safe value the first
time `initializePayment` runs for a given attempt (before any Paystack
call), since the column has no external consumer yet at that point (no
webhook has been sent, no customer has seen it) — this is a pure internal
correction, not a breaking change to any established contract. Documented
as a required disclosed correction to Phase 7's placeholder value, not a
reversal of any Phase 7 decision (Phase 7 explicitly never validated this
format against Paystack).

### 8.4 Payment initialization idempotency (§18 of the brief)

Deterministic rule, no ambiguity:

- **`initializePayment(attemptId)` itself is idempotent per attempt**: a
  second call against an attempt already `PENDING` does **not** call
  Paystack again — it re-checks (`db`) and returns the *existing*
  `authorizationUrl`/`accessCode` from the row. A second call against an
  attempt already terminal (`INITIALIZATION_FAILED`/`FAILED`/`ABANDONED`/`SUCCESS`)
  throws `ConflictError` — the caller (checkout's own response flow, or a
  "Retry Payment" action) is expected to have already resolved which
  attempt to call this against.
- **"Customer clicks Pay twice" / browser retries the POST**: resolved
  entirely by the above — both calls target the same, already-created
  `attemptId`; the guarded `UPDATE ... WHERE status = 'INITIATED'` ensures
  only the first actually calls Paystack; the second's guard fails,
  re-checks, and returns the first's result.
- **A new attempt is created only by an explicit "Retry Payment" action**
  (§10) against an order whose most recent attempt is terminal
  (`FAILED`/`ABANDONED`/`INITIALIZATION_FAILED`) — never automatically,
  never as a side effect of a stale `INITIATED` row simply existing.
- **No stale-`INITIATED`-expires sweep is proposed in this phase** — an
  attempt stuck in `INITIATED` (the Initialize call itself never returned
  at all — process crashed mid-call) is indistinguishable, from our own
  database's point of view, from one that's about to succeed in the next
  instant. §9 defines the recovery path for exactly this case (the "lost
  response problem").

---

## 9. Payment Verification

### 9.1 The lost-response problem (§9 of the brief) — worked through explicitly

```
Our server ──► Paystack Initialize ──► Paystack succeeds ──► network dies ──► we never see the response
```

**What is the payment attempt state?** Still `INITIATED` — our own
`UPDATE ... WHERE status = 'INITIATED'` never ran (we crashed/timed out
before or during receiving the response), so the row was never advanced.

**How does the customer recover?** They see a checkout error (the
synchronous `initializePayment` call from the checkout response flow
never returned success) and are offered "Retry"/"Try again" — which
re-invokes `initializePayment` against the **same** `attemptId` (not a
new one — the attempt is still `INITIATED`, so the idempotency rule in
§8.4 applies).

**How do we avoid creating another Paystack transaction unnecessarily on
retry, given Paystack has no officially-documented, confirmed
Idempotency-Key mechanism for Initialize** (verified against current
Paystack documentation and community sources during this planning pass —
no authoritative confirmation of a guaranteed idempotency contract for
this specific endpoint was found; this plan does **not** rely on Paystack
providing one)? The retry reuses the **same, already-stored**
`paystackReference` (per §8.3, generated once, before the very first
Paystack call for this attempt). Two concrete outcomes when Paystack
receives a second Initialize call with a reference it may have already
seen:

1. **Paystack genuinely never received the first call** (the network
   failure was on the way out, not on the way back) — Paystack processes
   this as a fresh Initialize with a reference it's never seen. Normal
   success path.
2. **Paystack did receive and process the first call**, and now receives
   a second Initialize with the *same* reference — Paystack's own
   reference-uniqueness rule means it will reject this as a duplicate
   reference (an API error, not a silent second transaction). **This is
   the desired outcome**, not a bug to work around: on catching this
   specific error, `initializePayment` does **not** create a new attempt
   or a new reference — it instead calls **Verify Transaction against the
   same reference** to discover Paystack's actual recorded state, and
   reconciles from that (transitions the attempt to `PENDING` with the
   real `authorization_url`/`access_code` if Paystack has them, or to
   `SUCCESS`/`FAILED` directly via the same verified-then-act path as
   §9.2 if the transaction somehow already completed).

**Retry semantics, stated precisely**: reference is **reused**, never
regenerated, once an attempt has had its first Paystack-safe reference
assigned (§8.3) and its first Initialize call attempted. A genuinely
**new** attempt (and therefore a new reference) is created only through
the explicit "Retry Payment" action (§10) against a *terminal* attempt —
never as an automatic reaction to an uncertain Initialize outcome for the
*same* attempt.

### 9.2 Verify-then-act, every time, for every webhook

No webhook payload field is ever trusted for a state transition. The
worker's processing step, for every `charge.*` event:

```
1. Resolve local payment_attempts row by paystackReference (from the webhook's data.reference)
2. IF not found: log, mark webhook_events row PROCESSED with a note — nothing local to act on
3. IF attempt.status !== 'PENDING': idempotent no-op (already resolved, or a stale replay) — mark webhook_events PROCESSED
4. Call Paystack Verify Transaction (server-side, using OUR stored paystackReference — never a
   reference or id read from the webhook payload alone, to defend against a forged webhook naming
   a reference that isn't actually this attempt's)
5. Compare:
   verifyResponse.data.status === "success"          — else -> FAILED path (§5)
   verifyResponse.data.amount === attempt.amountMinor  — exact match required
   verifyResponse.data.currency === attempt.currency   — exact match required
6. ALL pass -> §6.3's composed success transaction
   ANY fails -> do NOT mark SUCCESS; see §9.3 for exactly which failure produces which outcome
```

### 9.3 Amount/currency/status mismatch handling (§6 of the brief, no `?` left open)

| Condition | Outcome | Order effect |
|---|---|---|
| Underpayment (`verified.amount < attempt.amountMinor`) | Attempt -> `FAILED`, `errorCode = "AMOUNT_MISMATCH"`, sanitized `errorMessage` (no raw payload) | None — order stays `PENDING_PAYMENT`, retryable |
| Overpayment (`verified.amount > attempt.amountMinor`) | Attempt -> `FAILED` with the same code — **never** marked `SUCCESS` merely because "at least enough" was paid; an overpayment is a Paystack/customer-side anomaly requiring manual reconciliation (§23), not silent acceptance | None; flagged for reconciliation, since Paystack *did* charge real money that must eventually be refunded or manually resolved |
| Wrong currency | Attempt -> `FAILED`, `errorCode = "CURRENCY_MISMATCH"` | None |
| Malformed/unexpected Verify response shape (missing expected fields) | Attempt state **untouched** (stays `PENDING`); the `webhook_events` row's own processing fails and retries via its own attempt-count/backoff (§14); does not immediately fail the attempt, since this may be a transient Paystack-side or parsing issue, not proof the payment failed | None until resolved |
| Paystack reports "transaction not found" for our reference | Attempt -> `FAILED`, `errorCode = "VERIFICATION_NOT_FOUND"` | None |
| Verify Transaction call itself times out / network error | `webhook_events` row's processing attempt fails, retried by the worker (§14) with backoff — attempt state untouched | None until resolved |

Never trusted, ever, as authoritative: frontend amount, frontend currency,
the checkout success/callback page, the browser redirect, any
client-supplied payment reference. The authoritative amount/currency
always come from our own `payment_attempts` row (server-computed at
checkout, Phase 7, unchanged) compared against Paystack's own Verify
response — never the reverse.

---

## 10. Payment Retry

```
Order (unchanged throughout)
  ├── Attempt #1 → FAILED
  ├── Attempt #2 → INITIATED → PENDING → (customer abandons) → ABANDONED
  └── Attempt #3 → INITIATED → PENDING → SUCCESS
```

- **Who can retry**: the order's owner (session-authenticated) or a guest
  who can still resolve the order (Phase 6's existing, disclosed guest
  post-checkout-lookup limitation applies identically here — not solved
  or worsened by this phase).
- **When retry is allowed**: the order is `PENDING_PAYMENT` **and** its
  most-recent attempt (by `createdAt`) is terminal
  (`FAILED`/`ABANDONED`/`INITIALIZATION_FAILED`). An order that is `PAID`,
  `CANCELLED`, or any later status has no retry path — enforced by a
  fresh authoritative read of both the order and its latest attempt, never
  inferred from client-supplied state.
- **Whether failed attempts are terminal**: yes, absolutely — §5's table
  has no outgoing transition from any of the three failure states.
- **How the new attempt gets a unique reference**: `generatePaystackSafeReference("PAY")`
  (§8.3), freshly generated per new attempt, guaranteed distinct from
  every prior attempt's reference by the column's own `@unique` constraint
  (a collision would surface as an ordinary insert failure, statistically
  negligible given the entropy, the same tolerance `order-number.ts`
  already accepts for order numbers).
- **How the old attempt is preserved**: never deleted, never mutated after
  reaching its terminal state (§5) — `payment_attempts` rows are
  historical, exactly like `order_items`/`inventory_movements`.
- **What is *not* recreated on retry**: `Order`, `OrderItems`, the
  inventory reservation, or the cart. The reservation belongs to the
  order (`ARCHITECTURE.md` §7, "Reservation ownership" — reservation is
  referenced via `inventory_movements.order_item_id`, never a specific
  payment attempt), so retrying payment touches none of it.
- **Use-case**: `payment/use-cases/retry-payment.ts` — takes `(actor, orderId)`,
  verifies ownership/permission (mirroring `cancelOrder`'s
  ownership-or-`orders.update` shape, §22), verifies the order/attempt
  eligibility above, creates the new `payment_attempts` row (`INITIATED`),
  then calls `initializePayment` on it (§8) synchronously, returning
  `{ authorizationUrl }` to the client — exactly the same response shape
  checkout's own initial payment-attempt flow returns (§6.3, §35).

---

## 11. Multiple Successful Attempts

Scenario: `Attempt A -> SUCCESS`, `Attempt B -> SUCCESS`, both against the
same order (a genuine double charge — e.g., two browser tabs, or the
customer paid, saw a transient error, and paid again in a second Paystack
session before the first webhook arrived).

- **How `authoritative_payment_attempt_id` is claimed**: exactly once, by
  whichever success-processing transaction (§6.3) is the *first* to
  execute `markOrderPaidInTransaction`'s guarded
  `UPDATE orders ... WHERE status = 'PENDING_PAYMENT'` while the order is
  still in that state. This is not a new mechanism — it is the identical
  guarded-UPDATE-wins pattern already proven correct for
  `createOrder`/`cancelOrder`/`markOrderPaid` across Phases 5–7.
- **The atomic transaction that wins**: §6.3's composed transaction, for
  whichever attempt's webhook-processing reaches the guarded `UPDATE`
  first.
- **What happens to the second successful attempt**: its own `UPDATE payment_attempts SET status='SUCCESS' WHERE status='PENDING'`
  still succeeds independently (attempt B genuinely *was* charged
  successfully by Paystack — that is a true fact this system must record,
  not suppress). `markOrderPaidInTransaction`'s guarded `UPDATE`
  subsequently finds the order no longer `PENDING_PAYMENT` (already `PAID`
  by attempt A), returns `{ transitioned: false, order }` — **no second
  `SALE`, no second order transition, no error thrown.**
- **Does it become `SUCCESS_NON_AUTHORITATIVE`, remain `SUCCESS`, or enter
  another state?** **It remains `SUCCESS`.** No new enum value is added —
  adding one would be a schema change this plan explicitly avoids without
  proof of necessity (§32), and none is needed: "is this attempt
  authoritative" is **always** a derived comparison, never a stored
  status —

  ```sql
  attempt.status = 'SUCCESS' AND attempt.id <> orders.authoritative_payment_attempt_id
  ```

  This single predicate is the complete, sufficient definition of "a
  successful, non-authoritative attempt," for both this scenario and the
  late-payment-after-cancellation scenario (§17) — the same query surfaces
  both (§23), which is a deliberate simplification, not a coincidence.
- **How the system detects a duplicate charge**: the reconciliation query
  above (§23), run periodically/on-demand — no automatic real-time alert
  is proposed in this phase (out of scope, §31, beyond what §23 defines as
  MVP backend capability).
- **How reconciliation identifies it**: `payment/use-cases/list-reconciliation-flags.ts`
  (§23) surfaces every attempt matching the predicate above, joined to its
  order's current status, for admin review.
- **How a refund is initiated for the extra successful payment**: through
  the *ordinary* refund lifecycle (§18/§19) — `refunds.paymentAttemptId`
  can reference **any** `SUCCESS` attempt, authoritative or not; an admin
  with `payments.refund` requests a refund against attempt B specifically.
  **This plan does not, and cannot, make the schema "reverse an external
  double charge" automatically** — Paystack genuinely holds the customer's
  money twice at that point; a human-initiated refund via Paystack's own
  Refund API is the only correct remediation, exactly as the brief
  requires this plan to acknowledge.

---

## 12. Webhook Architecture

Adopted verbatim from `ARCHITECTURE.md` §6.3 — already fully designed and
approved; this plan carries it forward, refined against the actual schema
(confirmed: every field named below exists, §3) and Phase 8's own module
boundaries:

```
Paystack
   │  POST /api/paystack/webhook
   ▼
┌────────────────────────────────────────────────────────────────┐
│ Route Handler (app/api/paystack/webhook/route.ts)                │
│ 1. Read raw request body (bytes, not parsed JSON — needed for    │
│    signature verification)                                       │
│ 2. Verify x-paystack-signature (HMAC-SHA512, constant-time        │
│    compare, §21) → 401 and STOP if invalid, no DB write           │
│ 3. INSERT INTO webhook_events (...) — idempotent, §13             │
│    (the ONLY database write in this handler)                     │
│ 4. Return HTTP 200                                                │
└────────────────────────────────────────────────────────────────┘
                       │ (fully durable at this point)
                       ▼
┌────────────────────────────────────────────────────────────────┐
│ Async worker (src/jobs/process-webhook-events.ts,                 │
│ invoked by an authenticated internal cron endpoint, §14)          │
│ 5. Claim a PENDING (or stale-PROCESSING) row                      │
│ 6. Resolve to a payment_attempt or refund by reference            │
│ 7. Call Paystack Verify Transaction server-side (§9)               │
│ 8-10. Transition attempt/order/refund (§6.3, §15, §19)             │
│ 11. (Out of scope this phase — no notification system exists, §31)│
│ 12. Mark webhook_events row PROCESSED or FAILED                   │
└────────────────────────────────────────────────────────────────┘
```

The Route Handler **never** calls Paystack's Verify Transaction API and
**never** touches `orders`/`payment_attempts`/`inventory_*` — its entire
job is "authenticate and durably record." It must not:

- reserve or release inventory;
- mark an order `PAID`;
- process a refund;
- call any business use-case beyond the single durable insert;
- perform any long-running Paystack API call.

Every one of these is enforced structurally by *not putting the code to
do them anywhere the route handler can reach* — the route handler's only
import from the payment module is a single `ingestWebhookEvent(rawBody, signatureHeader)`
use-case that does exactly steps 1–4 and nothing else.

---

## 13. Webhook Event Idempotency

### 13.1 The idempotency key — confirmed, with one disclosed open risk

```sql
UNIQUE KEY uq_webhook_events_natural_key (event_type, paystack_transaction_id)
```

Already the actual schema constraint (§3) — not re-derived here. A second
delivery of the same event (same `event_type` + same `paystack_transaction_id`,
which Paystack does not change across redelivery attempts, per Paystack's
own webhook-retry documentation researched for this plan, §13.3) hits this
unique constraint on insert; the route handler treats that as "already
recorded," acknowledges 200, and does nothing further.

**The disclosed open risk, carried forward rather than silently assumed
away** (already flagged, unresolved, in both `ARCHITECTURE.md` §6.4 and
`DATABASE_DESIGN.md` at the schema-design stage): `paystack_transaction_id`
is a **`NOT NULL`** column. This requires every webhook event type this
system handles to reliably carry a non-null `data.id`. Based on Paystack's
publicly documented webhook shape (every event's `data` object "mirrors
the corresponding REST resource" and every REST resource Paystack exposes
carries its own `id`), this plan's working assumption is that `data.id`
is present for `charge.success`, `charge.failed`, `refund.pending`, and
`refund.processed` alike — **but this has not been verified against a
captured live payload**, which requires Paystack sandbox credentials this
planning phase does not have access to. **This plan's recommended interim
resolution, to be confirmed (not assumed) at implementation time**: if a
genuinely `data.id`-less event type is ever encountered, fall back to a
deterministic value —

```
paystack_transaction_id = "hash:" + SHA256(normalized JSON of the raw payload)
```

— which preserves the unique-index-based idempotency guarantee (the same
payload, redelivered, hashes identically) without requiring a schema
change. **This fallback must not be built speculatively** — it is
documented here as the resolution *if* the gap proves real, not
implemented until Phase 8's own implementation step confirms it's needed
(§34, §35).

### 13.2 Duplicate / malformed / edge-case event behavior

| Case | Behavior |
|---|---|
| Duplicate event (same `event_type` + `paystack_transaction_id`) | Unique-constraint violation on insert → treated as already-recorded, 200 returned, no further processing |
| Malformed event (unparseable JSON, missing `event`/`data`) | Signature verification still runs first; if the body parses enough to extract `event`/`data.id`, insert as usual and let the worker's own processing fail gracefully (§9.3's malformed-response row); if it cannot even be parsed enough to insert (no `event` string at all), reject with 400 before any DB write — there is nothing durable to record |
| Event without a usable transaction id | §13.1's disclosed fallback, pending confirmation |
| Refund events | Ingested through the identical mechanism — resolved to a `refunds` row (via `paystackReference`/`resolvedRefundId`) instead of a `payment_attempts` row during worker processing, never a separate ingestion path |
| Events arriving out of order (e.g., `charge.success` before an earlier `charge.failed` redelivery for the same reference, which should be impossible for the same transaction but is defended against anyway) | Every transition is a guarded `UPDATE ... WHERE status = <expected current>` — an out-of-order or logically-impossible transition simply fails its guard and is treated as an idempotent no-op or explicit conflict (never silently applied) |
| Processing status / retry count / failure handling | `processingAttempts` incremented on every claim (§14); a row exceeding `MAX_PROCESSING_ATTEMPTS` (recommended: 10, §34) is left `FAILED` rather than retried forever, surfaced via reconciliation (§23) |
| Worker claiming | §14 |

### 13.3 Paystack webhook delivery facts confirmed via official/current documentation (researched for this plan)

- Signature header: `x-paystack-signature`, HMAC-**SHA512** (not SHA256) of
  the raw request body, keyed with the secret key.
- Retry schedule: **live mode** — every 3 minutes for the first 4
  attempts, then hourly for up to 72 hours; **test mode** — hourly for up
  to 72 hours. Any non-`200` response counts as a failed delivery for this
  schedule. This directly informs §14's staleness/backoff tuning — our own
  webhook durability window must comfortably exceed 72 hours before
  treating an unprocessed event as permanently lost.
- Verify Transaction response distinguishes a top-level API-call-succeeded
  boolean from the substantive `data.status` field (`success`/`failed`/`abandoned`/`reversed`/etc.)
  — **this plan's Verify-response handling always reads `data.status`,
  never the top-level boolean, to decide payment outcome** (§9.2).
- No officially-confirmed `Idempotency-Key` header contract was found for
  the Initialize Transaction endpoint specifically — this plan does not
  rely on one (§9.1).
- Refund endpoint accepts either a transaction **reference or numeric id**
  in its `transaction` field — this plan always sends our own
  `payment_attempts.paystackReference` (already stored, already unique),
  confirming no new column is needed to separately store Paystack's
  numeric transaction id on `payment_attempts` (§32).

---

## 14. Webhook Worker

`src/jobs/process-webhook-events.ts` — the file `src/jobs/README.md`
already names. Crash-safe by construction, using only MySQL-backed
durability already provided by `webhook_events` — no in-memory queue, no
new infrastructure dependency (§30).

### 14.1 Claim mechanism

```sql
-- Step 1: read candidates (uses idx_webhook_events_claim)
SELECT id FROM webhook_events
WHERE processing_status = 'PENDING'
   OR (processing_status = 'PROCESSING' AND locked_at < NOW() - INTERVAL 5 MINUTE)
ORDER BY received_at ASC
LIMIT :batchSize;

-- Step 2: attempt to claim EACH candidate individually (guarded UPDATE)
UPDATE webhook_events
SET processing_status = 'PROCESSING', locked_at = NOW(), processing_attempts = processing_attempts + 1
WHERE id = :id
  AND (processing_status = 'PENDING' OR (processing_status = 'PROCESSING' AND locked_at < NOW() - INTERVAL 5 MINUTE));
-- count = 1 → claimed, proceed; count = 0 → another worker/run already claimed it, skip
```

This is the same guarded-UPDATE claim pattern already established
everywhere else in this codebase — no new concurrency primitive is
introduced.

### 14.2 Crash-safety table

| Scenario | Outcome |
|---|---|
| Worker crashes before claiming anything | Nothing changed; next run picks up the same `PENDING` rows |
| Worker crashes after claiming (row now `PROCESSING`), before doing any further work | Row stuck `PROCESSING` until `locked_at` ages past 5 minutes, then reclaimable by the next run |
| Worker crashes during external Verify Transaction call | Same as above — no local state was written yet, safe to reclaim and retry (Verify Transaction is a read-only call at Paystack, calling it twice is not a correctness risk) |
| Worker crashes after DB commit (attempt/order/inventory already transitioned) but before marking the `webhook_events` row `PROCESSED` | Row stuck `PROCESSING`, reclaimed after staleness timeout; **reprocessing is safe** — §9.2 step 3 finds `attempt.status !== 'PENDING'` (already `SUCCESS`) and treats it as an idempotent no-op before ever calling Verify again |
| Worker crashes after external verification but before any DB write | Same reclaim path; reprocessing simply re-verifies and re-attempts the transaction, which is itself idempotent |
| Worker runs the same event twice (e.g., staleness timeout was too aggressive and a still-alive worker also claims it) | The `UPDATE ... WHERE processing_status = 'PENDING' OR (...)` claim step can be won by only one of the two competing claims per row — MySQL serializes concurrent `UPDATE`s on the same row; the loser's `count = 0`, it moves on |
| Worker becomes permanently stuck / repeatedly fails the same event | `processing_attempts` cap (§13.2, recommended 10) — beyond the cap, leave `FAILED`, surfaced via reconciliation (§23), never retried automatically forever |

### 14.3 Invocation

Per `ARCHITECTURE.md` §15's own words ("a scheduled task (cron) hitting an
internal authenticated endpoint"): `app/api/internal/process-webhook-events/route.ts`,
a `POST` route protected by a shared internal secret header (not public,
never session-authenticated — it's a machine-to-machine trigger), which
calls `src/jobs/process-webhook-events.ts`'s exported run function. An
external scheduler (platform cron, or a container-level cron daemon per
the Docker deployment target, §15 of `ARCHITECTURE.md`) invokes this route
on a short interval (recommended: every 30–60 seconds, §29). The job
module itself remains pure Node/TypeScript with zero `next/*` dependency,
so it is also directly callable from a script/test harness without going
through HTTP.

---

## 15. Webhook Processing Transactions

The exact transaction for a successful-payment event is §6.3's composed
transaction. This section enumerates every race it defends against:

| Race | Mechanism | Why |
|---|---|---|
| Duplicate webhook delivery (same event redelivered) | Ingestion-level unique constraint (§13) + processing-level guarded `UPDATE` (§6.3) — defense in depth, either alone is sufficient | Ingestion catches the common case cheaply; processing-level idempotency holds even if ingestion's assumption (§13.1) ever needs its fallback |
| Duplicate worker execution (two workers claim what they believe are different but resolve to the same attempt) | Guarded `UPDATE payment_attempts ... WHERE status = 'PENDING'` — only one execution's `UPDATE` can match | Conditional UPDATE, not a lock — the established project-wide primitive |
| Late webhook (arrives after the order already resolved another way) | `markOrderPaidInTransaction`'s own guard (`WHERE status = 'PENDING_PAYMENT'`) | Reused unchanged from Phase 6 |
| Cancellation race (webhook success vs. admin/customer cancellation, genuinely concurrent) | Same guard — whichever's own guarded `UPDATE` executes first on the `orders` row wins; the loser's guard fails and takes its own defined non-transitioned path (§17) | This is the identical mechanism `order-concurrency.test.ts`'s existing `[3+4/7]` cancel-vs-pay test already proves correct — Phase 8 extends the same test shape, not a new mechanism |
| Payment-attempt mismatch (a webhook resolved to the wrong attempt somehow) | `requireMatchingPaymentAttempt`'s relational check (existing, unchanged) — verifies `paymentAttempt.orderId === orderId` before any mutation | Reused unchanged |
| Order mismatch | Same as above | Reused unchanged |
| Inventory double-sale | `completeSaleInTransaction`'s own dedup mechanism (`orderItemMovementDedupKey` generated column, `uq_one_reserve_release_sale_per_order_item`) plus the fact it is only ever reached via `markOrderPaidInTransaction`'s already-won guard | Reused unchanged — §16 |

No `SELECT ... FOR UPDATE` row lock is introduced anywhere in this plan.
Every race above is resolved by a conditional `UPDATE` or a unique
constraint — consistent with the instruction not to reflexively copy
Phase 4's row-locking pattern where a guarded UPDATE already suffices, and
consistent with every payment-adjacent race Phase 5/6 already solved the
same way.

---

## 16. Inventory Conversion

`completeSaleInTransaction` (`inventory/repo.ts`, unchanged, Phase 5) is
already composed inside `markOrderPaidInTransaction` (§6.2), which is
itself only ever reached after `markOrderPaidInTransaction`'s own guarded
`UPDATE orders ... WHERE status = 'PENDING_PAYMENT'` has already won.
Because a `PENDING_PAYMENT -> PAID` transition can only ever happen once
per order (the guard makes a second success structurally unreachable), and
because `completeSaleInTransaction` runs once per order item **inside**
that same already-won transition, **"one order item -> at most one
`SALE`" is guaranteed by composition, not by anything new this phase
adds.** The generated `orderItemMovementDedupKey` column
(`CONCAT('SALE-', order_item_id)`, backing
`uq_one_reserve_release_sale_per_order_item`) remains the final,
independent defense-in-depth layer, exactly as Phase 5 designed it.

**No change to Inventory's business behavior is proposed or required.**
The actual schema and existing code already prove this guarantee holds;
this plan's job was to confirm that, not to re-derive it.

---

## 17. Cancellation Race

```
Order = CANCELLED
        ↓
Paystack webhook arrives (charge.success)
        ↓
Verify Transaction confirms: yes, this really did succeed
```

`markOrderPaidInTransaction`'s guarded `UPDATE ... WHERE status = 'PENDING_PAYMENT'`
finds the order in `CANCELLED`, not `PENDING_PAYMENT` — `count = 0`.
`order-state-machine.ts` confirms structurally (not by convention) that
`CANCELLED` has zero outgoing transitions: **`CANCELLED -> PAID` is not
merely disallowed by application logic, it does not exist as an entry in
the transition table at all.** The order stays `CANCELLED`. Inventory is
untouched — `markOrderPaidInTransaction`'s non-transitioned branch never
reaches `completeSaleInTransaction` (confirmed directly against the
existing code, not assumed).

What this plan **adds** (a genuinely new step, entirely inside the payment
module, requiring zero change to `order/repo.ts`'s contract): when
`markOrderPaidInTransaction` returns `{ transitioned: false, order }` and
`order.status === 'CANCELLED'`, the payment-success transaction (§6.3)
writes an `audit_logs` entry (`action: "payment.succeeded_after_cancellation"`,
`entityType: "order"`, `entityId: order.id`, `beforeData`/`afterData`
capturing the attempt id and amount) **inside the same transaction** — this
is the audit trail requirement the brief calls mandatory, and it is a new
write this phase owns, not a retroactive change to Phase 6's
`markOrderPaid` contract (which already correctly returns enough
information — `transitioned: false` plus the current order — for this
caller to make that decision itself).

The payment attempt itself is still marked `SUCCESS` — this is a true
fact (Paystack really did charge the customer) that must never be
suppressed or silently overwritten. It is, by construction, now also a
"successful, non-authoritative" attempt under §11's exact predicate
(`orders.authoritativePaymentAttemptId` was never set, since the guard
never fired) — **the identical reconciliation query that surfaces a
double-payment also surfaces this case**, with no additional mechanism.
Refunding it goes through the ordinary refund lifecycle (§18/§19), driven
by an admin who sees it via reconciliation (§23).

---

## 18. Refund Architecture

Adopted verbatim from `ARCHITECTURE.md` §10.2 / `DATABASE_DESIGN.md` §9 —
the two-ledger allocation model, already schema-enforced (§3), already
proven correct in Phase 2B's own negative/positive tests (§2). This plan
does not redesign it.

```
REFUND_REQUESTED ──► REFUND_PENDING ──► REFUNDED
        │                   │
        │                   ├──────► REFUND_FAILED
        │                   └──────► REFUND_CANCELLED
        ├───────────────────────────► REFUND_FAILED
        └───────────────────────────► REFUND_CANCELLED
```

| Transition | Trigger | What moves |
|---|---|---|
| *(none)* → `REFUND_REQUESTED` | Admin with `payments.refund` requests a refund against a `SUCCESS` attempt | `pending_refund_amount_minor` **increases** by the requested amount, checked against `amount_minor − refunded − pending` (everything already confirmed *and* everything else in flight) — never mark this final on API acceptance alone (§18.1) |
| `REFUND_REQUESTED` → `REFUND_PENDING` | Paystack's Create Refund API accepts the request | **No ledger change** — the allocation from the step above stands; `orders.status` untouched |
| `REFUND_REQUESTED`/`REFUND_PENDING` → `REFUND_FAILED` | Refund API call fails outright, or Paystack's refund webhook reports failure | **Release**: `pending_refund_amount_minor` decreases by this refund's amount; `refunded_amount_minor` untouched |
| `REFUND_REQUESTED`/`REFUND_PENDING` → `REFUND_CANCELLED` | Admin deliberately aborts before Paystack confirms either way | **Release**, identical to `REFUND_FAILED` — kept as a distinct terminal state for a clean "gateway failure" vs. "human decision" audit trail |
| `REFUND_PENDING` → `REFUNDED` | Paystack's refund webhook (`refund.processed`, per current research — §18.2), ingested through the *same* `webhook_events` mechanism as charge events | **Confirm**: `pending_refund_amount_minor` decreases and `refunded_amount_minor` increases by the same amount, one transaction |
| `REFUNDED` reached | — | If the refunded amount equals the attempt's full paid amount, `orders.status -> REFUNDED` (state machine, §5 of `order-state-machine.ts`); a partial refund records the `refunds` row/amount without moving the order out of its current status |

### 18.1 Refunds are never final on API acceptance alone

`REFUND_REQUESTED -> REFUND_PENDING` (Paystack *accepted* the request) is
explicitly **not** `REFUNDED`. Only the async webhook-confirmed
`REFUND_PENDING -> REFUNDED` transition is final, mirroring exactly how a
payment's own `PENDING -> SUCCESS` is never assumed from the Initialize
call succeeding — the same verify-then-act discipline applies to both
directions of money movement.

### 18.2 Refund webhook event names — disclosed as unverified, same caveat as §13.1

Current research (this plan, not a live payload capture) found Paystack's
documented refund-lifecycle events as `refund.pending` and
`refund.processed`, with refund status values on Paystack's own side
described as "pending"/"processing" and "processed"/"reversed" for
success. **This plan maps `refund.processed` -> our `REFUNDED`,
`refund.pending` -> informational only (no local transition — we're
already `REFUND_PENDING` from the request-time write), and treats the
absence of a success confirmation within a configurable window as a
candidate for reconciliation (§23), not an automatic `REFUND_FAILED`.**
Exact event names and payload shape remain flagged for confirmation
against a captured live/sandbox payload before implementation — carried
forward from `ARCHITECTURE.md`'s own pre-existing caveat, not newly
introduced by this plan, and not resolved by guessing.

---

## 19. Refund Allocation

The exact three-transaction sequence from `DATABASE_DESIGN.md` §9/§21,
unchanged:

**Allocate** (at `REFUND_REQUESTED`, before calling Paystack):
```sql
BEGIN;
UPDATE payment_attempts
SET pending_refund_amount_minor = pending_refund_amount_minor + :amount
WHERE id = :attemptId
  AND refunded_amount_minor + pending_refund_amount_minor + :amount <= amount_minor;
-- count = 0 -> insufficient refundable balance, abort (ValidationError), no refunds row created
INSERT INTO refunds (payment_attempt_id, order_id, amount_minor, status, reason, requested_by, ...)
VALUES (..., 'REFUND_REQUESTED', ...);
INSERT INTO audit_logs (...);
COMMIT;
-- THEN, outside this transaction: call Paystack Create Refund
```

**Confirm** (webhook-driven, `REFUND_PENDING -> REFUNDED`):
```sql
BEGIN;
UPDATE refunds SET status = 'REFUNDED', processed_at = NOW() WHERE id = :refundId AND status = 'REFUND_PENDING';
-- count = 0 -> idempotent no-op, already confirmed
UPDATE payment_attempts
SET pending_refund_amount_minor = pending_refund_amount_minor - :amount,
    refunded_amount_minor = refunded_amount_minor + :amount
WHERE id = :attemptId;
-- (order transition per §18, if the refund makes the attempt fully refunded)
COMMIT;
```

**Release** (on `REFUND_FAILED`/`REFUND_CANCELLED`):
```sql
BEGIN;
UPDATE refunds SET status = :newStatus, processed_at = NOW() WHERE id = :refundId AND status IN ('REFUND_REQUESTED','REFUND_PENDING');
UPDATE payment_attempts SET pending_refund_amount_minor = pending_refund_amount_minor - :amount WHERE id = :attemptId;
COMMIT;
```

Every step is a guarded `UPDATE` or a single-row insert — no
`SELECT ... FOR UPDATE` is needed, because the CHECK-constraint-equivalent
guard (`refunded + pending + :amount <= amount_minor`) is expressed
directly in the `WHERE` clause of the allocating `UPDATE`, exactly as
`DATABASE_DESIGN.md` §9 already specifies and Phase 2B already tested
end-to-end (§2).

---

## 20. Refund Concurrency

```
Payment = ₦100,000
Refund A = ₦70,000 (requested first)
Refund B = ₦50,000 (requested concurrently)
```

Both `Allocate` transactions race on the same `payment_attempts` row's
guarded `UPDATE`. Whichever's `UPDATE` commits first sees
`refunded(0) + pending(0) + 70,000 <= 100,000` → succeeds, `pending_refund_amount_minor = 70,000`.
The second's `UPDATE` evaluates `refunded(0) + pending(70,000) + 50,000 <= 100,000`
→ `120,000 <= 100,000` is false → `count = 0` → refused, no `refunds` row
created, `ValidationError` surfaced to that admin. **The system never
allocates ₦120,000 against a ₦100,000 payment** — this is the exact
scenario Phase 2B's own negative test already exercised end-to-end (§2),
confirming the mechanism, not merely asserting it should work.

A smaller concurrent request (e.g., ₦30,000 instead of ₦50,000) *would*
succeed against the same ₦70,000-already-pending state
(`0 + 70,000 + 30,000 = 100,000 <= 100,000`) — exactly at the boundary,
correctly allowed, per the same already-tested behavior.

---

## 21. Security

### Webhook signatures

`x-paystack-signature`: HMAC-**SHA512** of the *raw* request body (not the
parsed/re-serialized JSON — re-serialization can alter whitespace/key
order and invalidate the signature) using `PAYSTACK_SECRET_KEY`, compared
via constant-time comparison (Node's `crypto.timingSafeEqual`). Requests
failing verification are rejected `401` **before** any database write —
verification happens before the `webhook_events` insert, never after.

### Secrets

`PAYSTACK_SECRET_KEY`: server-only, added to `lib/env.ts`'s Zod schema
(never a `NEXT_PUBLIC_*`-prefixed variable), read only by
`src/integrations/paystack/client.ts`, never imported by any Client
Component, never logged (`lib/logger.ts` already redacts
`*.paystackSecretKey` by field name — this plan's client config object
must use that exact field name to inherit the redaction for free).

### Payment references

A client-provided amount, currency, or payment reference is **never**
authoritative for anything (§9.3). The only client input this phase's
routes accept is: which order/attempt to retry payment for (an id,
ownership-checked, §22), and — for the webhook route — the raw Paystack
payload itself, which is verified by signature, never trusted by content
alone.

### IDOR

| Scenario | Enforcement |
|---|---|
| User A inspects User B's payment attempt | A `getPaymentAttemptsForOrder`-style read use-case scopes by the *order's* ownership (reusing `getOrderById`'s existing ownership-or-`orders.read`/`payments.read` pattern) — never a bare `paymentAttemptId` lookup with no ownership check |
| User A retries User B's payment | `retryPayment(actor, orderId)` re-verifies order ownership identically to `cancelOrder`'s existing pattern — ownership or an elevated permission, never inferred from a client-supplied `userId` |
| User A triggers User B's refund | Refunds are **admin-only** (`payments.refund`) — no customer-facing refund-request endpoint exists in this plan at all (§30); a customer cannot "trigger" a refund, only an admin can, and admin actions are permission-gated, not ownership-gated |
| A user manipulates the order/payment relationship (forged `orderId`/`paymentAttemptId` pairing) | `requireMatchingPaymentAttempt`'s existing relational check (unchanged) rejects any attempt/order pairing that doesn't actually match, at the repo layer, independent of whatever the caller claims |

### Admin permissions

**No new permission key is required.** `payments.read` (already seeded,
held by `staff` and `super_admin`) governs every read-only
payment/reconciliation view (§23). `payments.refund` (already seeded,
held only by `super_admin`) governs every refund-lifecycle mutation
(request, cancel). Reconciliation itself is a read capability
(`payments.read`) — identifying a problem is not the same permission as
acting on one.

---

## 22. Authorization / RBAC

| Capability | Permission required | Notes |
|---|---|---|
| Read own order's payment attempts (customer) | Ownership (no permission needed) | Mirrors `getOrderById`'s exact ownership-or-elevated-permission shape |
| Read any order's payment attempts (admin) | `payments.read` | |
| Retry own payment (customer) | Ownership | Mirrors `cancelOrder`'s exact shape |
| Request a refund | `payments.refund` | Admin-only, no customer path |
| Cancel a pending refund request | `payments.refund` | |
| View reconciliation flags (§23) | `payments.read` | |
| Webhook ingestion | *(no user identity at all — signature-verified, machine-to-machine)* | Not an RBAC concern; §21 |
| Webhook-worker cron trigger | *(shared internal secret, not a user session)* | Not an RBAC concern |

No new permission family is introduced. This directly answers the
brief's §21/§22 requirement to determine whether the existing permissions
are sufficient — they are, confirmed by mapping every capability this
phase needs against the seeded list (§2), not assumed.

---

## 23. Reconciliation

Backend query capabilities only — **no admin UI is built in this phase**
(§31). Each is a plain, indexed, read-only query a future admin
tool/dashboard can call through a `payments.read`-gated use-case:

| Signal | Query shape |
|---|---|
| Successful payment with missing local success (Paystack shows success, we show `PENDING`) | Requires an external reconciliation sweep against Paystack's own transaction list API — **flagged as a future enhancement, not built this phase** (it requires periodically listing Paystack's own transactions, which is a different capability from verifying a reference we already know about); the webhook+worker path already covers the normal case |
| Duplicate successful attempts | `payment_attempts WHERE status = 'SUCCESS' AND id <> (SELECT authoritative_payment_attempt_id FROM orders WHERE orders.id = payment_attempts.order_id)` (§11) |
| Successful payment against a cancelled order | Same query as above, filtered to `orders.status = 'CANCELLED'` (§17) — a strict subset of the duplicate-success query, confirming the earlier claim that one mechanism covers both |
| Stuck `INITIATED` attempts | `payment_attempts WHERE status = 'INITIATED' AND created_at < NOW() - INTERVAL :threshold` |
| Stuck webhook events | `webhook_events WHERE processing_status = 'PROCESSING' AND locked_at < NOW() - INTERVAL 5 MINUTE` (mid-reclaim, informational) or `processing_status = 'FAILED'` (exhausted retries, §14) |
| Failed webhook processing | `webhook_events WHERE processing_status = 'FAILED'` |
| Refund mismatch (allocated but never resolved) | `refunds WHERE status IN ('REFUND_REQUESTED','REFUND_PENDING') AND requested_at < NOW() - INTERVAL :threshold` |
| Amount/currency mismatch | `payment_attempts WHERE status = 'FAILED' AND error_code IN ('AMOUNT_MISMATCH','CURRENCY_MISMATCH')` |

`payment/use-cases/list-reconciliation-flags.ts` (or one use-case per
signal) is the only new surface this section proposes — plain reads,
`payments.read`-gated, no mutation.

---

## 24. Failure Matrix

| Failure | Local state | Paystack state | Recovery |
|---|---|---|---|
| Initialize timeout | `INITIATED` (unchanged — the guarded UPDATE to `PENDING` never ran) | Unknown to us until we act | Customer retries `initializePayment` against the **same** attempt; if Paystack already has the reference, its own duplicate-reference rejection triggers a Verify-and-reconcile path (§9.1) instead of blindly re-initializing |
| Initialize succeeds, response lost | `INITIATED` (we never saw the response) | `PENDING`-equivalent at Paystack (authorization URL exists) | Same as above — retry resolves via Paystack's duplicate-reference rejection + Verify, never a second real transaction |
| Verification timeout | `PENDING` (attempt untouched) | Success or failure already decided at Paystack, we just don't know yet | Worker retries the `webhook_events` row (processing-attempt backoff, §14); a subsequent webhook redelivery (Paystack's own 72-hour retry window, §13.3) provides another chance independently |
| Webhook duplicated | `SUCCESS`/`FAILED` (already resolved by the first delivery) | Success (unchanged, Paystack's record doesn't change on redelivery) | Ingestion-level unique constraint + processing-level guarded UPDATE both independently absorb it (§13, §15) — no local state changes on the duplicate |
| Webhook delayed | `PENDING` until the delayed webhook (or a worker's own scheduled Verify sweep, if one exists — not proposed this phase beyond the webhook path itself) arrives | Success (already true at Paystack, just not yet known to us) | Order stays `PENDING_PAYMENT`, reservation held (Phase 6, unchanged) until the webhook arrives within Paystack's 72-hour retry window; beyond that, only a customer support / reconciliation action recovers it (§23) |
| Webhook worker crash | `webhook_events` row `PROCESSING`, stale after 5 minutes | Success (already true, unaffected by our crash) | Staleness reclaim (§14.2) — another worker pass picks it up; no data lost, `webhook_events.raw_payload` is durable from ingestion |
| Payment failed | `FAILED` (terminal) | Failed/declined at Paystack | Order stays `PENDING_PAYMENT`; customer retries with a new attempt (§10) |
| Payment succeeds after cancellation | Attempt `SUCCESS` (non-authoritative, §11); order stays `CANCELLED` | Success — real money moved | Audit-logged (§17); admin manually initiates a refund against this specific attempt (§18) via reconciliation (§23) |
| Double payment | Both attempts `SUCCESS`; exactly one authoritative, order `PAID` exactly once | Success, twice — real money moved twice | Surfaced via reconciliation (§23) identically to the cancellation case; admin manually refunds the non-authoritative attempt |
| Refund API timeout | `REFUND_REQUESTED` (allocation stands — `pending_refund_amount_minor` still reflects it) | Unknown | Admin can retry the Create Refund call against the same `refunds` row (idempotent from our side: the allocation isn't duplicated by retrying the outbound call, only a new *webhook* would double-confirm, and confirmation is itself idempotent, §19) or explicitly cancel the request (`REFUND_CANCELLED`, releasing the allocation) if it's stuck long enough to warrant it |
| Refund webhook delayed | `REFUND_PENDING` (allocation still held) | Pending or already processed at Paystack, just not yet known locally | Reconciliation flag (§23) surfaces a `refunds` row stuck in `REFUND_REQUESTED`/`REFUND_PENDING` past a configurable threshold for manual admin follow-up |

No `?` remains in this table.

---

## 25. State Machine Diagrams

### 25.1 Payment Attempt

```
                 ┌──────────────┐
                 │  INITIATED   │  (created at checkout commit, Phase 7)
                 └──────┬───────┘
        Initialize API succeeds │ Initialize API fails
                 ┌──────▼───────┐         ┌────────────────────────┐
                 │   PENDING    │         │ INITIALIZATION_FAILED  │ (terminal)
                 └──┬───────┬───┘         └────────────────────────┘
   verified success │       │ verified failure
          ┌─────────▼──┐ ┌──▼───────┐   ┌───────────┐
          │  SUCCESS   │ │  FAILED  │   │ ABANDONED │  (TTL sweep, terminal)
          │ (terminal) │ │(terminal)│   └───────────┘
          └────────────┘ └──────────┘
```
Actor: `SUCCESS`/`FAILED` transitions are driven by the async worker
(§14) after Verify Transaction (§9); `INITIALIZATION_FAILED` is driven
synchronously by the checkout/retry request itself. External dependency:
Paystack Initialize (INITIATED→PENDING/INITIALIZATION_FAILED path) and
Paystack Verify Transaction (PENDING→SUCCESS/FAILED path). DB transaction
boundary: each arrow is exactly one guarded single-row `UPDATE`, except
`PENDING -> SUCCESS`, which is the first statement of §6.3's composed
transaction. Invalid transitions: any arrow not drawn above — all rejected
by the guard clause matching zero rows.

### 25.2 Order ↔ Payment Attempt

```
Order: PENDING_PAYMENT ──────────────────────────────────────┐
   │                                                           │
   │ CANCEL (customer/admin, Phase 6, unchanged)               │ attempt -> SUCCESS,
   ▼                                                           │ verified (§9)
CANCELLED (terminal — no attempt can ever move this to PAID)   ▼
                                                          Order: PAID
                                                     (guarded UPDATE wins exactly once,
                                                      §6.3/§11 — every other concurrently-
                                                      successful attempt stays non-authoritative)
```
Actor: the async worker, on behalf of "Paystack confirmed success."
Transaction boundary: §6.3. External dependency: Verify Transaction.
Invalid transitions: `CANCELLED -> PAID` (does not exist in
`order-state-machine.ts` at all, confirmed directly, §2).

### 25.3 Webhook Event

```
(insert, ingestion route)
        │
        ▼
    PENDING ──claim (guarded UPDATE)──► PROCESSING ──success──► PROCESSED
        ▲                                    │
        │                                    │ failure (attempts < cap)
        └────────────staleness reclaim───────┘
                                              │ failure (attempts >= cap)
                                              ▼
                                            FAILED (terminal, reconciliation, §23)
```
Actor: the ingestion route (`PENDING` insert), the worker (`PROCESSING`,
`PROCESSED`, `FAILED`). Transaction boundary: the claim `UPDATE` is its
own transaction (single statement); processing itself composes into
§6.3/§19's transactions depending on event type. External dependency: the
worker's processing step calls Paystack Verify/refund-status
implicitly via the same verified-payment path. Invalid transitions: `PROCESSED -> `
anything (terminal, never reprocessed automatically).

### 25.4 Refund

```
(admin request, Allocate transaction, §19)
            │
            ▼
    REFUND_REQUESTED ──Paystack accepts──► REFUND_PENDING ──webhook confirms──► REFUNDED (terminal)
            │                                    │
            │ admin cancels / API fails          │ admin cancels / webhook reports failure
            ▼                                    ▼
    REFUND_CANCELLED (terminal)          REFUND_FAILED (terminal)
    REFUND_FAILED (terminal)             REFUND_CANCELLED (terminal)
```
Actor: admin (`REFUND_REQUESTED`, `REFUND_CANCELLED`), Paystack API
response (`REFUND_PENDING`, immediate `REFUND_FAILED`), async worker via
webhook (`REFUNDED`, delayed `REFUND_FAILED`). Transaction boundary: §19's
three named transactions (Allocate/Confirm/Release). External dependency:
Paystack Create Refund API (request time), Paystack refund webhook
(confirm/fail time). Invalid transitions: any transition out of
`REFUNDED`/`REFUND_FAILED`/`REFUND_CANCELLED` — all three are terminal,
matching the actual `RefundStatus` enum's lack of any further value to
transition to.

---

## 26. Transaction Boundaries

| Transaction | Owner | First statement | Rows locked | Conditional updates | Writes | External calls | Commit point | Failure behavior |
|---|---|---|---|---|---|---|---|---|
| Payment initialization | `payment/repo.ts` | *(none — single guarded UPDATE, no transaction wrapper needed)* | `payment_attempts` (1 row, by guard) | `WHERE status = 'INITIATED'` | `payment_attempts` (status, authorization_url/access_code OR error_code/error_message) | **Paystack Initialize, before the UPDATE** | The `UPDATE` itself | Paystack call failure → `INITIALIZATION_FAILED` write; no partial state possible (single statement) |
| Webhook ingestion | `app/api/paystack/webhook/route.ts` (via a payment use-case) | `INSERT INTO webhook_events` | None (insert-only; unique constraint is the guard) | Unique constraint on insert | `webhook_events` (1 row) | None | The `INSERT` itself | Duplicate → constraint violation caught, treated as already-recorded, 200 returned |
| Webhook claim | `src/jobs/process-webhook-events.ts` | `UPDATE webhook_events SET processing_status='PROCESSING' WHERE ...` | `webhook_events` (1 row, by guard) | `WHERE processing_status = 'PENDING' OR (...)` | `webhook_events` (status, locked_at, processing_attempts) | None | The `UPDATE` itself | `count = 0` → another worker already claimed it, skip |
| Successful-payment processing | `payment/repo.ts` | `UPDATE payment_attempts SET status='SUCCESS' WHERE ... AND status='PENDING'` (Verify Transaction call happens **before** this, outside any transaction) | `payment_attempts` (1), `orders` (1, via `markOrderPaidInTransaction`), `inventory_items` (N, via `completeSaleInTransaction`) | `WHERE status='PENDING'` (attempt), `WHERE status='PENDING_PAYMENT'` (order), `WHERE quantity_reserved >= saleQty` (inventory, unchanged Phase 5) | `payment_attempts`, `orders`, `order_status_history`, `inventory_items`, `inventory_movements`, optionally `audit_logs` (§17) | **None inside this transaction** — Verify Transaction already happened before it opened | The final statement (audit log or history insert) | Any guard failure → the whole transaction is either a clean idempotent no-op (already processed) or rolls back entirely; no partial commit |
| Failed-payment processing | `payment/repo.ts` | `UPDATE payment_attempts SET status='FAILED' WHERE id=:id AND status='PENDING'` | `payment_attempts` (1) | `WHERE status='PENDING'` | `payment_attempts` only | None inside the transaction (Verify already happened before) | The `UPDATE` itself | `count=0` → already resolved, no-op |
| Retry-attempt creation | `payment/repo.ts` | `INSERT INTO payment_attempts` | None (fresh row) | Eligibility pre-check via a plain read (order + latest attempt, both immutable-enough at this point) before the transaction, mirroring `resolveOrderLine`'s established pre-transaction-resolution pattern | `payment_attempts` (1 row) | None (Initialize is a separate subsequent step, §8) | The `INSERT` itself | Eligibility check failure → `ConflictError`/`ValidationError` before any write |
| Refund allocation | `payment/repo.ts` | `UPDATE payment_attempts SET pending_refund_amount_minor = ... WHERE ... AND refunded+pending+:amt <= amount_minor` | `payment_attempts` (1) | The allocation guard itself | `payment_attempts`, `refunds` (insert), `audit_logs` | **None inside this transaction** — Paystack Create Refund is called *after* commit | The `refunds`/`audit_logs` insert | `count=0` on the guard → `ValidationError`, no `refunds` row created at all |
| Refund confirmation | `payment/repo.ts` | `UPDATE refunds SET status='REFUNDED' WHERE id=:id AND status='REFUND_PENDING'` | `refunds` (1), `payment_attempts` (1), `orders` (1, conditionally) | `WHERE status='REFUND_PENDING'` | `refunds`, `payment_attempts`, optionally `orders` (state-machine `REFUND` transition) | None (webhook already delivered the fact; no outbound call needed to confirm) | Final statement | `count=0` → already confirmed, no-op |
| Refund failure/cancellation | `payment/repo.ts` | `UPDATE refunds SET status=:new WHERE id=:id AND status IN (...)` | `refunds` (1), `payment_attempts` (1) | `WHERE status IN ('REFUND_REQUESTED','REFUND_PENDING')` | `refunds`, `payment_attempts` | None | Final statement | `count=0` → already resolved, no-op |

**No external HTTP request occurs inside any database transaction listed
above** — every Paystack API call (Initialize, Verify, Create Refund) is
made either before a transaction opens or after it commits, never inside
one. This is a hard rule this plan enforces structurally, the same way
Phase 7 enforced it for the Checkout↔Order↔Inventory transaction (never
calling Paystack inside the checkout transaction).

---

## 27. Observability

Structured logs (via the existing `pino` logger, `lib/logger.ts`,
unchanged) for: payment attempt creation, Paystack initialization
(success/failure), verification (attempted/result), webhook ingestion
(accepted/rejected-by-signature/duplicate), webhook processing
(claimed/succeeded/failed), payment success, payment failure, duplicate
webhook detected, duplicate/non-authoritative payment detected,
reconciliation-flag-worthy state observed, refund request, refund
success/failure.

**Never logged**, under any circumstance (verified against
`lib/logger.ts`'s existing redaction config, which already anticipates
this): `PAYSTACK_SECRET_KEY`/any field named `*paystackSecretKey*`,
Paystack authorization codes (`access_code` is a *transaction* access
code for the client-side redirect, not a card credential, but is still
excluded from log lines by convention — only the payment-attempt `id`/
`reference` correlate a log line, never the access code itself), raw
session/guest tokens (unchanged, pre-existing rule), full card data
(never touches this server at all — Paystack's hosted checkout page
keeps this system out of PCI scope beyond SAQ-A, per `ARCHITECTURE.md`
§17), raw webhook payloads at `info` level (the *fact* that a webhook of
a given `event_type` was received is logged; the full `raw_payload` is
persisted in `webhook_events.raw_payload` for on-demand inspection, not
routinely emitted to the log stream).

Correlation identifiers used consistently across every log line above:
`orderId`, `paymentAttemptId`, `paystackReference` (safe to log — it's
our own generated string, never a secret), `webhookEventId`, `refundId`.

---

## 28. Testing Strategy

### 28.1 Unit

State machines (`payment-attempt-state-machine.ts`,
`refund-state-machine.ts` — pure, mirroring `order-state-machine.ts`'s
exact shape and exhaustive-transition-table test style), signature
verification (constant-time compare correctness, tamper detection),
amount/currency validation predicates, webhook event classification
(§13.2's malformed/duplicate/refund-vs-charge branching, as a pure
function wherever it can be factored out of I/O), refund allocation
arithmetic (pure, mirroring `order-totals.ts`'s approach).

### 28.2 Integration — real MySQL, unchanged conventions

Payment attempt creation and `INITIATED -> PENDING`/`INITIALIZATION_FAILED`
transitions (against the fake Paystack adapter, §28.4); verification
(`PENDING -> SUCCESS`/`FAILED`, including every branch of §9.3's table);
successful payment (full §6.3 transaction, asserting order/inventory/
history state via fresh queries); failed payment; duplicate webhook
(ingestion-level and processing-level, separately); worker retry
(processing-attempts increment, eventual `FAILED` at the cap); worker
crash simulation (a test directly manipulates `locked_at` into the past
and confirms reclaim); payment-attempt ownership (IDOR, mirroring
`cart-authorization.test.ts`'s/`order-authorization.test.ts`'s
established shape); order ownership; cancellation race (direct extension
of `order-concurrency.test.ts`'s existing `[3+4/7]` cancel-vs-pay test,
now racing a webhook-driven success against `cancelOrder`); inventory
`SALE` dedup (reusing Phase 5's existing dedup-key assertions); refund
allocation; partial refunds; refund failure; refund confirmation.

### 28.3 Concurrency — real MySQL, 5+ consecutive runs, fresh-DB-query
assertions, `Promise.allSettled`, exactly the established convention

1. Two identical success webhooks (same event) — exactly one processing
   effect.
2. Two different, both-successful attempts against the same order —
   exactly one authoritative, order `PAID` exactly once (§11).
3. Success webhook vs. cancellation — self-consistent final state,
   whichever wins (direct extension of the existing precedent test).
4. Success webhook vs. another worker (simulated dual-claim) — exactly
   one claims and processes.
5. Duplicate refund requests (same admin, double-submitted) — exactly one
   `refunds` row, or a clean rejection for the second.
6. Refund confirmation vs. a retry of the confirmation step — idempotent,
   single ledger movement.
7. Two partial refunds competing for the remaining balance — the exact
   §20 scenario, asserting the losing request is cleanly rejected, never
   over-allocated.
8. Webhook ingestion duplicate (concurrent, not sequential) — the unique
   constraint resolves it regardless of arrival order.
9. Worker crash after claim (simulated via a forced staleness) —
   reclaimed exactly once by the next pass.
10. Worker crash after DB commit, before marking `PROCESSED` — reprocessed
    safely, no double effect (§14.2).

### 28.4 External Paystack testing — a deterministic fake, real everything else

```
fake Paystack (a test-only implementation of the same
src/integrations/paystack/client.ts function signatures)
        +
real MySQL
        +
real application code (use-cases, repo, worker, routes)
        =
deterministic payment integration testing
```

- **Never** make real calls to Paystack's live or sandbox API during
  ordinary test runs — no test in this suite depends on network access to
  `api.paystack.co`.
- The integration boundary is exactly `src/integrations/paystack/client.ts`'s
  exported function signatures (`initializeTransaction`, `verifyTransaction`,
  `createRefund`) — tests inject a fake implementation satisfying the same
  TypeScript interface (mirroring the existing `TokenDelivery`
  test-injection precedent, `tests/integration/helpers/fixtures.ts`'s
  `createCapturingTokenDelivery()`), not a mocked HTTP layer underneath a
  real client.
- **Not mocked**: our database transaction behavior, our state machines,
  inventory correctness, the webhook claim/staleness mechanism — all
  exercised for real against real MySQL.
- Signature verification is tested against a **real** HMAC-SHA512
  computation using a test secret key — not faked, since it's pure
  cryptographic logic with no external dependency at all.
- A small, separate, manual/opt-in verification step (not part of the
  automated suite, not built or scheduled in this phase) is recommended
  before production launch: a single real sandbox-mode Initialize +
  Verify + webhook round trip, specifically to close the two disclosed
  open risks in §13.1/§18.2 (confirm `data.id` presence, confirm exact
  refund event names) against a real captured payload.

---

## 29. Performance

- **Webhook ingestion**: verify signature → persist → acknowledge. No
  business logic, no external call, one indexed insert. Target: well
  under 200ms server time per delivery, comfortably inside any reasonable
  request timeout, and irrelevant to Paystack's 72-hour retry tolerance
  either way.
- **Payment verification** (worker-driven, not request-driven): bounded
  by Paystack's own Verify Transaction API latency — no artificial
  internal budget beyond "don't hold a DB transaction open across it"
  (§26, already enforced structurally).
- **Webhook worker throughput**: batch size and cron interval (§14.3,
  recommended 30–60 seconds) sized to keep the `PENDING` backlog small
  under normal load; no specific SLA is set in this phase beyond "well
  inside Paystack's 72-hour redelivery window" (§13.3) — precise tuning
  is an operational, not architectural, concern.
- **Payment lookup / payment-attempt listing**: `idx_payment_attempts_order_status`
  and `idx_payment_attempts_status_created` (already existing indexes,
  confirmed against the schema) cover every read pattern this plan's
  use-cases need — order-scoped lookups and admin status-filtered lists —
  with no new index required.
- **Refund allocation**: single-row guarded `UPDATE`, already indexed by
  primary key — no measurable cost beyond ordinary write latency.

---

## 30. MVP Scope

Paystack Initialize + Verify integration; webhook ingestion + async
processing worker; payment-attempt state machine (all six states);
payment retry; refund request/cancel/confirm lifecycle with two-ledger
allocation; the reconciliation *queries* defined in §23; the security/IDOR
protections in §21/§22; the test matrix in §28.

## 31. Out of Scope

Explicitly excluded, deferred to future phases: storefront/checkout UI
for payment (redirect-to-`authorization_url` is the only "UI" this phase
touches, and it's a plain redirect, not a component built in this phase);
admin payment/reconciliation **dashboard UI** (§23 defines the backend
queries only); Redis; Elasticsearch; any notification system (order
confirmation email, admin alert — §12's step 11 is explicitly marked
"out of scope this phase, no notification system exists"); SMS; shipping/
fulfillment; accounting/settlement reconciliation beyond the MVP
operational queries in §23; a customer-facing refund-request flow (§21 —
refunds remain admin-only); a real-time external reconciliation sweep
against Paystack's own transaction-listing API (§23, flagged as a future
enhancement); chargeback/dispute handling (Paystack's dispute webhooks are
a distinct event family this plan does not touch — nothing in the current
`webhook_events`/`refunds` schema was designed around disputes, and
extending to them is a genuinely separate, larger design question for a
future phase, not something the current schema quietly already supports).

---

## 32. Database Sufficiency Review

**No migration required.** Reviewed field-by-field against every behavior
this plan specifies:

| Need | Existing field | Sufficient? |
|---|---|---|
| Unique Paystack reference per attempt | `payment_attempts.paystackReference` (`@unique`, `VarChar(100)`) | Yes |
| Authorization URL / access code storage | `authorizationUrl` (`VarChar(500)`), `accessCode` (`VarChar(100)`) | Yes |
| Sanitized failure metadata | `errorCode` (`VarChar(50)`), `errorMessage` (`VarChar(500)`) | Yes |
| Channel / gateway response text | `channel` (`VarChar(30)`), `gatewayResponse` (`VarChar(255)`) | Yes |
| Paid/failed timestamps | `paidAt`, `failedAt` | Yes |
| Authoritative-attempt pointer, set exactly once | `orders.authoritativePaymentAttemptId` (`@unique` FK) | Yes |
| "Successful but non-authoritative" state | **No new enum value needed** — derived by comparison (§11), not stored | Yes, by design |
| Webhook idempotency key | `webhook_events` unique `(eventType, paystackTransactionId)` | Yes, **with the disclosed §13.1 risk carried forward, not newly introduced** |
| Webhook claim/staleness mechanism | `processingStatus`, `lockedAt`, `processingAttempts`, indexed by `idx_webhook_events_claim` | Yes |
| Resolving a webhook to its target entity | `resolvedPaymentAttemptId`/`resolvedRefundId` (mutually exclusive, CHECK-enforced) | Yes |
| Refund pending/confirmed ledger | `pendingRefundAmountMinor`/`refundedAmountMinor`, generated `availableRefundableAmountMinor` | Yes |
| Refund over-allocation prevention | `chk_payment_attempts_refund_allocation` CHECK constraint | Yes |
| Refund audit reason | `refunds.reason` (`Text`) | Yes |
| Refund failure/webhook payload capture | `refunds.rawWebhookPayload` (`Json?`) — no dedicated `errorMessage` column on `refunds`, but this JSON field is sufficient to capture full failure context; no new column needed | Yes |
| Storing Paystack's numeric transaction id per attempt | **Not needed** — Paystack's Refund/Verify APIs both accept our own reference string; `webhookEvents.paystackTransactionId` already captures it where it matters (idempotency) | Yes, confirmed by API research (§13.3), not assumed |
| Reference character-set correctness | Not a schema concern — `VarChar(100)` accepts any string; this is a *generation-format* correction (§8.3), not a schema deficiency | N/A |
| Metadata passed to Paystack (orderId) | Not persisted locally — sent to Paystack only, recoverable from `payment_attempts.orderId` | Yes, no new column needed |

**Every field this plan needs already exists.** No STOP condition from
§35 is triggered.

---

## 33. Risks

1. **Webhook idempotency key field presence is unverified against a live
   payload** (§13.1) — carried forward from `ARCHITECTURE.md`/
   `DATABASE_DESIGN.md`'s own pre-existing, unresolved caveat, not
   introduced by this plan. Mitigation: the documented hash-fallback
   (§13.1), confirmed only if implementation-time testing proves it's
   actually needed.
2. **Refund webhook event names are unverified against a live payload**
   (§18.2) — same class of risk, same source document caveat.
3. **Phase 7's placeholder payment-attempt reference format is not
   Paystack-safe** (§8.3) — resolved by this plan's own reference
   regeneration step; low risk once implemented, since it's caught before
   any external call is ever made against an existing reference.
4. **No officially-confirmed Idempotency-Key contract for Paystack's
   Initialize endpoint** (§9.1) — mitigated by reference-reuse +
   Verify-on-duplicate-rejection, not by assuming Paystack provides
   request-level idempotency it may not.
5. **Webhook delivery depends entirely on Paystack's own retry window
   (72 hours)** — an event that fails to deliver even once within that
   window, and whose worker-side retries (§14) are also exhausted, has no
   automatic recovery path in this plan beyond the reconciliation queries
   (§23) surfacing a stuck `PENDING_PAYMENT` order for manual follow-up.
   A future external reconciliation sweep (§31, out of scope) would close
   this gap fully.
6. **No real external double-charge can be reversed by any schema or code
   design** — every mitigation in this plan (§11, §17) detects and
   surfaces the condition; the actual money movement still requires a
   human-initiated Paystack refund. This is a stated, permanent
   limitation of any payment integration, not a defect in this plan.

---

## 34. Open Questions

| # | Question | Current options | Recommended | Reason | Phase decision becomes mandatory |
|---|---|---|---|---|---|
| 1 | Is `data.id` reliably non-null for every webhook event type this system handles (charge and refund alike)? | (a) Assume yes, no fallback; (b) build the hash-based fallback (§13.1) unconditionally; (c) confirm via a live/sandbox payload capture first, build the fallback only if proven necessary | (c) | Building unverified defensive code for a risk that may not exist adds complexity with no proven benefit; a single sandbox transaction/refund capture resolves this cheaply before implementation | Before Phase 8 implementation begins |
| 2 | Exact refund webhook event name(s) (`refund.processed` vs. others Paystack may also send, e.g. a distinct pending/failed event) | (a) Implement against currently-researched names only; (b) capture a live sandbox refund first | (b) | Getting this wrong silently drops refund confirmations — higher-stakes than #1 | Before refund webhook processing is implemented |
| 3 | Webhook worker invocation mechanism: authenticated internal HTTP endpoint + external cron, vs. a long-running in-process poller | (a) Cron-hits-endpoint (this plan's recommendation, §14.3); (b) long-running poller process | (a) | Matches `ARCHITECTURE.md` §15's own stated MVP approach exactly; no new standing-process infrastructure needed | Before Phase 8 implementation begins |
| 4 | `MAX_PROCESSING_ATTEMPTS` for a webhook event before it's left permanently `FAILED` | Any positive integer; this plan suggests 10 | 10 | Balances "don't retry forever" against Paystack's own 72-hour/hourly retry cadence (§13.3) — 10 attempts at a 30–60s poll interval is far faster than that window, leaving room for the worker itself to also be temporarily down without exhausting the budget | Before Phase 8 implementation begins |
| 5 | Exact staleness timeout for reclaiming a stuck `PROCESSING` webhook row | `ARCHITECTURE.md` §6.3 already specifies 5 minutes | 5 minutes (already decided, restated here for completeness) | Pre-existing decision, not reopened by this plan | Already decided |
| 6 | Should an `ABANDONED`-attempt / stuck-`INITIATED` TTL sweep be built in this phase, or deferred like Cart's own abandonment sweep (Phase 7, disclosed limitation)? | (a) Build it now; (b) defer, matching Phase 7's own precedent | (b) | No job-runner infrastructure exists beyond the webhook worker this phase adds; scope discipline favors building exactly what's needed for payment correctness now, not a general TTL-sweep framework | Before this becomes an operational pain point post-launch |
| 7 | Should the payment module expose a `getPaymentStatus(orderId)` polling endpoint for the browser's advisory `/checkout/callback` page (per `ARCHITECTURE.md` §6.7), or should that page simply call the existing `getOrderById`? | (a) New payment-specific read; (b) reuse Order's existing read use-case, since order status already reflects payment success | (b) | No new use-case needed — `orders.status` transitioning to `PAID` already is the fact the callback page needs; avoids a redundant read surface | Before the callback page/route is implemented |

---

## 35. Implementation Sequence

Derived from this plan's actual dependency structure, not assumed:

1. Add `PAYSTACK_SECRET_KEY` (and any small config constants —
   staleness timeout, max processing attempts, poll interval) to
   `lib/env.ts`'s Zod schema.
2. `src/integrations/paystack/` — `client.ts` (Initialize, Verify, Create
   Refund), `signature.ts`, `types.ts`, `reference.ts` (§8.3's Paystack-safe
   generator). Unit-testable in isolation with a fake `fetch`.
3. `payment/domain/payment-attempt-state-machine.ts`,
   `payment/domain/refund-state-machine.ts` — pure, unit-tested first.
4. `payment/schema.ts`, `payment/types.ts`.
5. **The required additive extension to `order/repo.ts`**
   (`markOrderPaidInTransaction`, §6.2) — built and verified *before* any
   Payment code depends on it, with Order's *entire* existing test suite
   re-run immediately afterward to confirm zero regression (the exact
   discipline Phase 6/7 each already applied to their own extensions).
6. `payment/repo.ts`: reads first, then the composed success/failure
   transactions (§6.3), then refund allocate/confirm/release (§19).
7. `payment/use-cases/initialize-payment.ts`, `retry-payment.ts`.
8. **The required additive extension to `checkout/use-cases/complete-checkout.ts`**
   — calling `initializePayment` synchronously after `checkoutRepo.completeCheckout`
   returns, folding `authorizationUrl` (or an initialization-failure
   signal) into the checkout response DTO, without ever surfacing a
   Paystack failure as an order-creation failure (§6.3, §8). Checkout's
   existing test suite re-run immediately afterward.
9. Webhook ingestion: `payment/use-cases/ingest-webhook-event.ts`,
   `app/api/paystack/webhook/route.ts` (thin, per §12).
10. `src/jobs/process-webhook-events.ts`, `app/api/internal/process-webhook-events/route.ts`.
11. `payment/use-cases/process-successful-payment.ts`,
    `process-failed-payment.ts` — called by the worker.
12. `payment/use-cases/request-refund.ts`, `cancel-refund.ts`,
    `process-refund-webhook.ts`.
13. `payment/use-cases/list-payment-attempts-for-order.ts` (customer/admin
    read), `list-reconciliation-flags.ts` (admin read, §23).
14. Minimal API routes for the above reads/mutations, matching every
    existing module's thin-route convention.
15. Unit tests (can start as early as step 3).
16. Integration tests — happy paths first, then failure/authorization/
    IDOR, then the mandatory 10-scenario concurrency suite last (§28.3).
17. E2E tests — real HTTP, fake Paystack adapter injected, no browser
    (matching every prior phase's `request`-fixture-only convention).
18. Full verification suite (typecheck/lint/format/unit/integration/
    concurrency ×5+/e2e/production build/ESLint boundary re-test/security
    scan/database-cleanliness), matching every prior phase's bar exactly.
19. Implementation report, disclosing any deviations found during
    implementation, per the established convention.

---

## 36. Hard Stop Criteria

Implementation must **STOP and report** rather than proceed if any of the
following is discovered during Phase 8 implementation (not encountered
during this planning pass — none of these were found; listed as the
carried-forward trigger conditions per the brief's own §35/§36):

- The schema cannot actually support the lifecycle described here once
  real Paystack payloads are captured (e.g., §34 question 1 resolves
  unfavorably in a way no documented fallback can absorb without a
  column-width or type change).
- `order-state-machine.ts`'s existing transition table genuinely conflicts
  with a payment requirement (none found — confirmed directly against the
  file, §2).
- Inventory cannot safely convert reservation to sale under a scenario
  this plan didn't anticipate.
- The webhook model lacks required durability once real payload shapes
  are known.
- Paystack's *actual* current API (confirmed only once sandbox
  credentials are available) contradicts an assumption this plan made
  from documentation research alone (§7, §9, §13.3, §18.2).
- Existing permissions prove insufficient once real admin workflows are
  built (none found — confirmed sufficient, §22).
- Phase 7's payment-attempt boundary creates a correctness problem this
  plan's additive `markOrderPaidInTransaction` extension cannot resolve
  without breaking `markOrderPaid`'s existing contract (none found —
  confirmed the extension is purely additive, §6.2).

If none of these occur, implementation proceeds through §35's sequence
without further approval gates beyond the standard per-phase review this
project has used since Phase 3.

---

**Verification performed on this document before completion:**

1. Re-read the entire plan.
2. Verified every internal `§NN` cross-reference resolves to the correct
   section under this document's final numbering.
3. Verified every schema field cited in §3–§32 against the actual
   `prisma/schema.prisma` Payments-domain models — no field was assumed
   without direct confirmation.
4. Verified state-machine consistency: §5 (Payment Attempt) and §25.1
   agree exactly; §18/§25.4 (Refund) agree exactly; §6/§25.2 (Order↔Payment)
   agree exactly.
5. Verified every transaction boundary in §26 contains no external HTTP
   call inside its stated commit boundary.
6. Verified Paystack behavioral claims (§7, §9.1, §13.3, §18.2) are
   attributed to current research performed for this plan, not assumed
   from training-data memory, and every unconfirmed detail is explicitly
   flagged as such (§33, §34) rather than silently presented as fact.
7. Confirmed no unresolved decision was silently assumed — every genuinely
   open item is listed in §34, not buried in prose elsewhere.

**PHASE 8 PLAN COMPLETE — AWAITING APPROVAL**

import { Prisma } from "@prisma/client";
import type { PaymentAttempt, Refund, WebhookEvent } from "@prisma/client";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { generatePaystackSafeReference } from "@/src/integrations/paystack/reference";
// Repo-to-repo import — ESLint-legal, the same "Option A" pattern
// docs/PHASE_6_ORDER_PLAN.md §7 established for Order<->Inventory,
// extended here for Payment<->Order (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md
// §6.2). Never imports Order's use-cases or any HTTP-facing surface.
import * as orderRepo from "@/src/modules/order/repo";

/**
 * Data access layer — the only file in this module allowed to import the
 * Prisma client, per docs/ARCHITECTURE.md §1. Every `$transaction`
 * boundary and every guarded conditional `UPDATE` live here.
 */

/** Prisma's P2002 error on MySQL reports `meta.target` as a single string
 * (the index name) — same empirically-confirmed shape Phase 5/6/7 already
 * relied on. Small, deliberate duplication, kept local to this module. */
function isUniqueConstraintViolation(error: unknown, hint: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const target = error.meta?.target;
  return typeof target === "string" && target.includes(hint);
}

function isDeadlockOrWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

/**
 * Retries on a genuine MySQL deadlock/write-conflict (Prisma `P2034`) —
 * found via the mandatory concurrency test suite, not by inspection:
 * `processSuccessfulPayment`'s composed transaction touches
 * `payment_attempts` (this attempt), `orders` (the shared row two
 * different attempts for the same order both contend for), and
 * `inventory_items`, and InnoDB's deadlock detector can abort either side
 * of that three-way lock interleaving under genuine concurrency — this
 * is MySQL's own documented recommendation ("Please retry your
 * transaction"), not a bug this codebase's guarded-UPDATE pattern alone
 * can prevent. Every guard/idempotency check inside `fn` still runs in
 * full on each attempt — a retry is a fresh, independent execution, not
 * a resume.
 */
async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isDeadlockOrWriteConflict(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findAttemptById(
  id: bigint,
): Promise<PaymentAttempt | null> {
  return db.paymentAttempt.findUnique({ where: { id } });
}

export async function findAttemptByReference(
  reference: string,
): Promise<PaymentAttempt | null> {
  return db.paymentAttempt.findUnique({
    where: { paystackReference: reference },
  });
}

export async function findLatestAttemptForOrder(
  orderId: bigint,
): Promise<PaymentAttempt | null> {
  return db.paymentAttempt.findFirst({
    where: { orderId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function listAttemptsForOrder(
  orderId: bigint,
): Promise<PaymentAttempt[]> {
  return db.paymentAttempt.findMany({
    where: { orderId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function findRefundById(id: bigint): Promise<Refund | null> {
  return db.refund.findUnique({ where: { id } });
}

export async function listRefundsForAttempt(
  paymentAttemptId: bigint,
): Promise<Refund[]> {
  return db.refund.findMany({
    where: { paymentAttemptId },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
  });
}

// ---------------------------------------------------------------------------
// Admin-wide refund queue (Phase 10 additive extension —
// docs/PHASE_10_ADMIN_PLAN.md §14/§28.6/§31: no admin-wide "all refunds"
// read existed before this; every prior refund read was scoped to one
// attempt (`listRefundsForAttempt`) or bounded to "stuck" ones
// (`listStuckRefunds`). Keyset cursor on `(requestedAt, id)` descending,
// matching `listRefundsForAttempt`'s own existing sort order and every
// other admin list's `CursorPage<T>` convention (`listOrdersForAdmin`,
// `listInventoryItems`) — never `OFFSET`.
// ---------------------------------------------------------------------------

export interface RefundListCursor {
  requestedAt: Date;
  id: bigint;
}

/** Base64url of `requestedAt|id`, matching
 * `src/modules/order/repo.ts`'s `encodeOrderListCursor` pattern exactly. */
export function encodeRefundListCursor(cursor: RefundListCursor): string {
  return Buffer.from(
    `${cursor.requestedAt.toISOString()}|${cursor.id}`,
  ).toString("base64url");
}

export function decodeRefundListCursor(raw: string): RefundListCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const [isoDate, idString] = decoded.split("|");
    if (!isoDate || !idString) return null;
    const requestedAt = new Date(isoDate);
    if (Number.isNaN(requestedAt.getTime())) return null;
    return { requestedAt, id: BigInt(idString) };
  } catch {
    return null;
  }
}

export interface ListRefundsForAdminFilters {
  status?: Refund["status"];
  cursor?: RefundListCursor;
  limit: number;
}

export async function listRefundsForAdmin(
  filters: ListRefundsForAdminFilters,
): Promise<{ rows: Refund[]; nextCursor: string | null }> {
  const conditions: Prisma.RefundWhereInput[] = [];
  if (filters.status) {
    conditions.push({ status: filters.status });
  }
  if (filters.cursor) {
    conditions.push({
      OR: [
        { requestedAt: { lt: filters.cursor.requestedAt } },
        {
          requestedAt: filters.cursor.requestedAt,
          id: { lt: filters.cursor.id },
        },
      ],
    });
  }

  const rows = await db.refund.findMany({
    where: conditions.length > 0 ? { AND: conditions } : {},
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: filters.limit + 1,
  });

  const hasNextPage = rows.length > filters.limit;
  const pageRows = hasNextPage ? rows.slice(0, filters.limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasNextPage && lastRow
      ? encodeRefundListCursor({
          requestedAt: lastRow.requestedAt,
          id: lastRow.id,
        })
      : null;
  return { rows: pageRows, nextCursor };
}

// ---------------------------------------------------------------------------
// Attempt creation (retry) — plan §10
// ---------------------------------------------------------------------------

export interface CreateRetryAttemptData {
  orderId: bigint;
  amountMinor: number;
  currency: string;
}

/** A fresh reference every time, via the Paystack-safe generator (plan
 * §8.3) — the `paystack_reference` column's own `@unique` constraint is
 * the final defense against a collision, exactly like
 * `order-number.ts`'s established tolerance for its own random suffix. */
export async function createRetryAttempt(
  data: CreateRetryAttemptData,
): Promise<PaymentAttempt> {
  return db.paymentAttempt.create({
    data: {
      orderId: data.orderId,
      paystackReference: generatePaystackSafeReference("PAY"),
      amountMinor: data.amountMinor,
      currency: data.currency,
      status: "INITIATED",
    },
  });
}

// ---------------------------------------------------------------------------
// Initialization transitions — plan §8, single-row guarded UPDATEs, no
// transaction needed (one table, one row, no cross-table write)
// ---------------------------------------------------------------------------

export interface MarkAttemptPendingData {
  authorizationUrl: string;
  accessCode: string;
}

export async function markAttemptPending(
  attemptId: bigint,
  data: MarkAttemptPendingData,
): Promise<{ transitioned: boolean }> {
  const result = await db.paymentAttempt.updateMany({
    where: { id: attemptId, status: "INITIATED" },
    data: {
      status: "PENDING",
      authorizationUrl: data.authorizationUrl,
      accessCode: data.accessCode,
    },
  });
  return { transitioned: result.count > 0 };
}

export interface MarkAttemptInitializationFailedData {
  errorCode: string;
  errorMessage: string;
}

export async function markAttemptInitializationFailed(
  attemptId: bigint,
  data: MarkAttemptInitializationFailedData,
): Promise<{ transitioned: boolean }> {
  const result = await db.paymentAttempt.updateMany({
    where: { id: attemptId, status: "INITIATED" },
    data: {
      status: "INITIALIZATION_FAILED",
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      failedAt: new Date(),
    },
  });
  return { transitioned: result.count > 0 };
}

// ---------------------------------------------------------------------------
// Success / failure processing — plan §6.3, the composed transaction
// ---------------------------------------------------------------------------

export interface ProcessSuccessfulPaymentData {
  attemptId: bigint;
  orderId: bigint;
  gatewayResponse: string | null;
  channel: string | null;
  paidAt: Date;
}

export interface ProcessSuccessfulPaymentResult {
  /** Whether THIS call's own guarded UPDATE actually transitioned the
   * attempt PENDING -> SUCCESS — `false` means an idempotent no-op
   * (already SUCCESS from an earlier call). */
  attemptTransitioned: boolean;
  orderTransitioned: boolean;
  order: orderRepo.OrderWithRelations;
}

/**
 * The composed successful-payment transaction
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §6.3). The Paystack Verify call
 * has already happened before this function is ever invoked — nothing
 * here makes an external call. Wrapped in `withDeadlockRetry` — found via
 * the mandatory concurrency test suite: two different attempts for the
 * same order, both racing to succeed, can trigger a genuine InnoDB
 * deadlock across the `payment_attempts` -> `orders` -> `inventory_items`
 * lock chain, which MySQL itself resolves by aborting one side and
 * asking the caller to retry.
 */
export async function processSuccessfulPayment(
  data: ProcessSuccessfulPaymentData,
): Promise<ProcessSuccessfulPaymentResult> {
  return withDeadlockRetry(() => attemptProcessSuccessfulPayment(data));
}

async function attemptProcessSuccessfulPayment(
  data: ProcessSuccessfulPaymentData,
): Promise<ProcessSuccessfulPaymentResult> {
  // Idempotency fast path (mirrors reserveInventory/completeInventorySale's
  // established pattern, Phase 5) — a sequential duplicate call (e.g. a
  // redelivered webhook processed after the first delivery's processing
  // already fully committed) must not re-run the guarded UPDATE below.
  const existing = await db.paymentAttempt.findUnique({
    where: { id: data.attemptId },
  });
  if (!existing) {
    throw new NotFoundError("Payment attempt not found.");
  }
  if (existing.status === "SUCCESS") {
    const order = await orderRepo.findOrderById(data.orderId);
    if (!order) throw new NotFoundError("Order not found.");
    return { attemptTransitioned: false, orderTransitioned: false, order };
  }
  if (existing.status !== "PENDING") {
    throw new ConflictError(
      `Payment attempt is not eligible for success (current status: ${existing.status}).`,
    );
  }

  return db.$transaction(async (tx) => {
    const guarded = await tx.paymentAttempt.updateMany({
      where: { id: data.attemptId, status: "PENDING" },
      data: {
        status: "SUCCESS",
        gatewayResponse: data.gatewayResponse,
        channel: data.channel,
        paidAt: data.paidAt,
      },
    });

    if (guarded.count === 0) {
      // Guard failure has two possible causes (mirrors reserveInventory's
      // identical reasoning, Phase 5): genuinely already resolved by a
      // concurrent process that committed between the fast-path check
      // above and this guarded UPDATE, or a real conflict. Reads via
      // `db`, NOT `tx` — the established defense-in-depth discipline for
      // every guard-failure recheck in this codebase.
      const current = await db.paymentAttempt.findUnique({
        where: { id: data.attemptId },
      });
      if (current?.status === "SUCCESS") {
        const order = await orderRepo.findOrderById(data.orderId);
        if (!order) throw new NotFoundError("Order not found.");
        return { attemptTransitioned: false, orderTransitioned: false, order };
      }
      throw new ConflictError(
        "Payment attempt is no longer eligible for success.",
      );
    }

    // The additive Order primitive (plan §6.2) — its own internal
    // ownership check reads via `tx`, correctly seeing the SUCCESS write
    // just made above in this same, still-uncommitted transaction.
    const orderResult = await orderRepo.markOrderPaidInTransaction(tx, {
      orderId: data.orderId,
      paymentAttemptId: data.attemptId,
    });

    // Plan §17 — a genuinely new step this phase adds, requiring zero
    // change to Order's own contract: `markOrderPaidInTransaction`
    // already tells us whether it transitioned and the order's current
    // status, which is enough to detect "payment succeeded after
    // cancellation" and record it for reconciliation (plan §23).
    if (!orderResult.transitioned && orderResult.order.status === "CANCELLED") {
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorType: "SYSTEM",
          action: "payment.succeeded_after_cancellation",
          entityType: "order",
          entityId: data.orderId,
          afterData: {
            paymentAttemptId: data.attemptId.toString(),
            orderId: data.orderId.toString(),
          },
        },
      });
    }

    return {
      attemptTransitioned: true,
      orderTransitioned: orderResult.transitioned,
      order: orderResult.order,
    };
  });
}

export interface ProcessFailedPaymentData {
  attemptId: bigint;
  errorCode: string;
  errorMessage: string;
}

export async function processFailedPayment(
  data: ProcessFailedPaymentData,
): Promise<{ transitioned: boolean }> {
  const result = await db.paymentAttempt.updateMany({
    where: { id: data.attemptId, status: "PENDING" },
    data: {
      status: "FAILED",
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      failedAt: new Date(),
    },
  });
  return { transitioned: result.count > 0 };
}

// ---------------------------------------------------------------------------
// Refund allocation / confirmation / release — plan §19, the
// Allocate/Confirm/Release three-transaction pattern, unchanged from the
// approved Phase 2B design
// ---------------------------------------------------------------------------

export interface AllocateRefundData {
  paymentAttemptId: bigint;
  orderId: bigint;
  amountMinor: number;
  reason: string | null;
  requestedBy: bigint;
}

/**
 * The Allocate transaction. The guard
 * (`refunded + pending + :amount <= amount_minor`) is a genuine
 * column-vs-column-vs-literal comparison Prisma's query builder cannot
 * express type-safely — the same limitation Phase 4/5 already
 * encountered — so this uses `$executeRaw` with fully parameterized
 * values (never string-concatenated), matching
 * `inventory/repo.ts`'s `listInventoryItems` precedent for the identical
 * class of problem.
 */
export async function allocateRefund(
  data: AllocateRefundData,
): Promise<Refund> {
  return db.$transaction(async (tx) => {
    const affectedRows = await tx.$executeRaw`
      UPDATE payment_attempts
      SET pending_refund_amount_minor = pending_refund_amount_minor + ${data.amountMinor}
      WHERE id = ${data.paymentAttemptId}
        AND status = 'SUCCESS'
        AND refunded_amount_minor + pending_refund_amount_minor + ${data.amountMinor} <= amount_minor
    `;
    if (affectedRows === 0) {
      throw new ValidationError(
        "Insufficient refundable balance, or this payment attempt is not eligible for a refund.",
      );
    }

    const refund = await tx.refund.create({
      data: {
        paymentAttemptId: data.paymentAttemptId,
        orderId: data.orderId,
        amountMinor: data.amountMinor,
        status: "REFUND_REQUESTED",
        reason: data.reason,
        requestedBy: data.requestedBy,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: data.requestedBy,
        actorType: "USER",
        action: "payment.refund_requested",
        entityType: "payment_attempt",
        entityId: data.paymentAttemptId,
        afterData: {
          refundId: refund.id.toString(),
          amountMinor: data.amountMinor,
        },
      },
    });

    return refund;
  });
}

/** Paystack's Create Refund API accepted the request — plan §18, no
 * ledger change, just the status label. */
export async function markRefundPending(
  refundId: bigint,
): Promise<{ transitioned: boolean }> {
  const result = await db.refund.updateMany({
    where: { id: refundId, status: "REFUND_REQUESTED" },
    data: { status: "REFUND_PENDING" },
  });
  return { transitioned: result.count > 0 };
}

const ORDER_REFUND_ELIGIBLE_STATUSES = [
  "PAID",
  "PROCESSING",
  "READY_FOR_DISPATCH",
  "SHIPPED",
  "DELIVERED",
] as const;

/**
 * The Confirm transaction — moves the allocation from pending to
 * confirmed, and transitions the order to `REFUNDED` if this confirms
 * the attempt's *full* amount (plan §18/§19). Callable directly (e.g. by
 * an admin action that has independently confirmed a refund actually
 * completed) — real refund-webhook-driven invocation is deferred (plan
 * §13.1/§18.2's disclosed, unverified payload shape; see the
 * implementation report).
 */
export async function confirmRefund(
  refundId: bigint,
): Promise<{ transitioned: boolean }> {
  const existing = await db.refund.findUnique({ where: { id: refundId } });
  if (!existing) {
    throw new NotFoundError("Refund not found.");
  }
  if (existing.status === "REFUNDED") {
    return { transitioned: false };
  }
  if (existing.status !== "REFUND_PENDING") {
    throw new ConflictError(
      `Refund is not eligible for confirmation (current status: ${existing.status}).`,
    );
  }

  return db.$transaction(async (tx) => {
    const guarded = await tx.refund.updateMany({
      where: { id: refundId, status: "REFUND_PENDING" },
      data: { status: "REFUNDED", processedAt: new Date() },
    });
    if (guarded.count === 0) {
      const current = await db.refund.findUnique({ where: { id: refundId } });
      if (current?.status === "REFUNDED") return { transitioned: false };
      throw new ConflictError("Refund is no longer eligible for confirmation.");
    }

    await tx.paymentAttempt.update({
      where: { id: existing.paymentAttemptId },
      data: {
        pendingRefundAmountMinor: { decrement: existing.amountMinor },
        refundedAmountMinor: { increment: existing.amountMinor },
      },
    });

    // Reads its own just-applied write above — always correct regardless
    // of snapshot timing (a transaction always sees its own writes).
    const attempt = await tx.paymentAttempt.findUniqueOrThrow({
      where: { id: existing.paymentAttemptId },
    });

    if (attempt.refundedAmountMinor >= attempt.amountMinor) {
      // Descriptive-only pre-read via `db` for the history label — the
      // guarded UPDATE below (not this read) is the actual authority on
      // whether the transition is allowed.
      const orderBefore = await db.order.findUnique({
        where: { id: existing.orderId },
        select: { status: true },
      });
      const orderGuard = await tx.order.updateMany({
        where: {
          id: existing.orderId,
          status: { in: [...ORDER_REFUND_ELIGIBLE_STATUSES] },
        },
        data: { status: "REFUNDED" },
      });
      if (orderGuard.count > 0) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: existing.orderId,
            fromStatus: orderBefore?.status ?? "UNKNOWN",
            toStatus: "REFUNDED",
            actorType: "WEBHOOK",
            actorId: null,
          },
        });
      }
    }

    return { transitioned: true };
  });
}

/** The Release transaction — `REFUND_FAILED`/`REFUND_CANCELLED` both
 * release the pending allocation identically (plan §18/§19). */
export async function releaseRefund(
  refundId: bigint,
  newStatus: "REFUND_FAILED" | "REFUND_CANCELLED",
): Promise<{ transitioned: boolean }> {
  const existing = await db.refund.findUnique({ where: { id: refundId } });
  if (!existing) {
    throw new NotFoundError("Refund not found.");
  }
  if (existing.status === newStatus) {
    return { transitioned: false };
  }
  if (
    existing.status !== "REFUND_REQUESTED" &&
    existing.status !== "REFUND_PENDING"
  ) {
    throw new ConflictError(
      `Refund is not eligible for this transition (current status: ${existing.status}).`,
    );
  }

  return db.$transaction(async (tx) => {
    const guarded = await tx.refund.updateMany({
      where: {
        id: refundId,
        status: { in: ["REFUND_REQUESTED", "REFUND_PENDING"] },
      },
      data: { status: newStatus, processedAt: new Date() },
    });
    if (guarded.count === 0) {
      const current = await db.refund.findUnique({ where: { id: refundId } });
      if (current?.status === newStatus) return { transitioned: false };
      throw new ConflictError(
        "Refund is no longer eligible for this transition.",
      );
    }

    await tx.paymentAttempt.update({
      where: { id: existing.paymentAttemptId },
      data: { pendingRefundAmountMinor: { decrement: existing.amountMinor } },
    });

    return { transitioned: true };
  });
}

// ---------------------------------------------------------------------------
// Webhook ingestion + claim — plan §12/§13/§14, MySQL-backed durability
// only, no in-memory queue
// ---------------------------------------------------------------------------

export interface InsertWebhookEventData {
  eventType: string;
  paystackTransactionId: string;
  paystackReference: string | null;
  rawPayload: Prisma.InputJsonValue;
}

/** Idempotent insert — a duplicate `(eventType, paystackTransactionId)`
 * hits the existing unique constraint and is treated as "already
 * recorded" (plan §13.1), never a hard failure the caller needs to
 * distinguish from a genuine error. */
export async function insertWebhookEvent(
  data: InsertWebhookEventData,
): Promise<{ inserted: boolean; id: bigint | null }> {
  try {
    const created = await db.webhookEvent.create({
      data: {
        eventType: data.eventType,
        paystackTransactionId: data.paystackTransactionId,
        paystackReference: data.paystackReference,
        rawPayload: data.rawPayload,
      },
    });
    return { inserted: true, id: created.id };
  } catch (error) {
    if (isUniqueConstraintViolation(error, "webhook_events_natural_key")) {
      return { inserted: false, id: null };
    }
    throw error;
  }
}

/**
 * Read-only candidate scan (uses `idx_webhook_events_claim`) — the
 * worker then attempts to individually claim each candidate via the
 * guarded UPDATE below; `count = 1` means this call won, `count = 0`
 * means another worker/run already claimed it (plan §14.1).
 *
 * The staleness cutoff is computed in application code (`new Date()`),
 * never MySQL's own `NOW()` — found via testing, not by inspection: this
 * environment's MySQL server clock and the application server's clock
 * are not guaranteed to agree (confirmed empirically, off by roughly an
 * hour here), which would silently corrupt any comparison mixing a
 * JS-written `locked_at` timestamp against a SQL-computed `NOW()`. Every
 * other timestamp comparison in this codebase already avoids this
 * (Better Auth session validation compares
 * `expiresAt: { gt: new Date() }` via the query builder, never raw SQL
 * `NOW()`) — this is the same discipline, applied to the one place in
 * this module that needed a raw query at all.
 */
export async function findClaimableWebhookEventIds(
  batchSize: number,
  staleMinutes = env.WEBHOOK_STALE_LOCK_MINUTES,
): Promise<bigint[]> {
  const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const rows = await db.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM webhook_events
    WHERE processing_status = 'PENDING'
       OR (processing_status = 'PROCESSING' AND locked_at < ${staleCutoff})
    ORDER BY received_at ASC
    LIMIT ${batchSize}
  `;
  return rows.map((r) => r.id);
}

export async function claimWebhookEvent(
  id: bigint,
  staleMinutes = env.WEBHOOK_STALE_LOCK_MINUTES,
): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const now = new Date();
  const affectedRows = await db.$executeRaw`
    UPDATE webhook_events
    SET processing_status = 'PROCESSING', locked_at = ${now}, processing_attempts = processing_attempts + 1
    WHERE id = ${id}
      AND (processing_status = 'PENDING'
           OR (processing_status = 'PROCESSING' AND locked_at < ${staleCutoff}))
  `;
  return affectedRows > 0;
}

export interface WebhookEventOutcomeProcessed {
  status: "PROCESSED";
  resolvedPaymentAttemptId?: bigint;
  resolvedRefundId?: bigint;
}
export interface WebhookEventOutcomeRetryOrFail {
  status: "RETRY" | "FAILED";
  errorMessage: string;
}
export type WebhookEventOutcome =
  WebhookEventOutcomeProcessed | WebhookEventOutcomeRetryOrFail;

export async function recordWebhookEventOutcome(
  id: bigint,
  outcome: WebhookEventOutcome,
): Promise<void> {
  if (outcome.status === "PROCESSED") {
    await db.webhookEvent.update({
      where: { id },
      data: {
        processingStatus: "PROCESSED",
        processedAt: new Date(),
        resolvedPaymentAttemptId: outcome.resolvedPaymentAttemptId ?? null,
        resolvedRefundId: outcome.resolvedRefundId ?? null,
      },
    });
    return;
  }

  await db.webhookEvent.update({
    where: { id },
    data: {
      // "RETRY" returns the row to PENDING immediately, rather than
      // waiting out the full staleness timeout, so a transient failure
      // recovers quickly; "FAILED" (attempts exhausted, plan §13.2) is
      // permanent until manual reconciliation (plan §23).
      processingStatus: outcome.status === "FAILED" ? "FAILED" : "PENDING",
      errorMessage: outcome.errorMessage,
    },
  });
}

export async function findWebhookEventById(
  id: bigint,
): Promise<WebhookEvent | null> {
  return db.webhookEvent.findUnique({ where: { id } });
}

// ---------------------------------------------------------------------------
// Reconciliation reads — plan §23, backend queries only, no admin UI
// ---------------------------------------------------------------------------

/** A `SUCCESS` attempt that is not (or no longer) its order's
 * authoritative attempt — the single predicate covering BOTH a genuine
 * double payment and a late payment after cancellation (plan §11/§17). */
export async function listNonAuthoritativeSuccessfulAttempts(): Promise<
  PaymentAttempt[]
> {
  return db.$queryRaw<PaymentAttempt[]>`
    SELECT pa.* FROM payment_attempts pa
    JOIN orders o ON o.id = pa.order_id
    WHERE pa.status = 'SUCCESS'
      AND (o.authoritative_payment_attempt_id IS NULL
           OR o.authoritative_payment_attempt_id <> pa.id)
  `;
}

export async function listStuckInitiatedAttempts(
  thresholdMinutes: number,
): Promise<PaymentAttempt[]> {
  return db.paymentAttempt.findMany({
    where: {
      status: "INITIATED",
      createdAt: { lt: new Date(Date.now() - thresholdMinutes * 60 * 1000) },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function listStuckOrFailedWebhookEvents(
  staleMinutes = env.WEBHOOK_STALE_LOCK_MINUTES,
): Promise<WebhookEvent[]> {
  const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  return db.$queryRaw<WebhookEvent[]>`
    SELECT * FROM webhook_events
    WHERE processing_status = 'FAILED'
       OR (processing_status = 'PROCESSING' AND locked_at < ${staleCutoff})
    ORDER BY received_at ASC
  `;
}

export async function listStuckRefunds(
  thresholdMinutes: number,
): Promise<Refund[]> {
  return db.refund.findMany({
    where: {
      status: { in: ["REFUND_REQUESTED", "REFUND_PENDING"] },
      requestedAt: { lt: new Date(Date.now() - thresholdMinutes * 60 * 1000) },
    },
    orderBy: { requestedAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Admin dashboard metrics (docs/PHASE_10_ADMIN_PLAN.md §9) — read-only.
// ---------------------------------------------------------------------------

const PENDING_STATUSES: PaymentAttempt["status"][] = ["INITIATED", "PENDING"];
const FAILED_STATUSES: PaymentAttempt["status"][] = [
  "FAILED",
  "INITIALIZATION_FAILED",
  "ABANDONED",
];

export interface PaymentMetrics {
  pendingPayments: number;
  failedAttempts: number;
  refundedAmountMinor: number;
}

/** Three independent, indexed reads (`payment_attempts(status, ...)` already
 * exists) — no N+1, no new index required. */
export async function getPaymentMetrics(): Promise<PaymentMetrics> {
  const [pendingPayments, failedAttempts, refundedAggregate] =
    await Promise.all([
      db.paymentAttempt.count({ where: { status: { in: PENDING_STATUSES } } }),
      db.paymentAttempt.count({ where: { status: { in: FAILED_STATUSES } } }),
      db.paymentAttempt.aggregate({ _sum: { refundedAmountMinor: true } }),
    ]);

  return {
    pendingPayments,
    failedAttempts,
    refundedAmountMinor: refundedAggregate._sum.refundedAmountMinor ?? 0,
  };
}

export interface WebhookWorkerHealthSnapshot {
  pendingCount: number;
  processingCount: number;
  staleProcessingCount: number;
  failedCount: number;
  exhaustedCount: number;
  oldestPendingReceivedAt: Date | null;
}

/** Operational health snapshot for scheduler/worker monitoring. */
export async function getWebhookWorkerHealthSnapshot(
  staleMinutes = env.WEBHOOK_STALE_LOCK_MINUTES,
  maxAttempts = env.WEBHOOK_MAX_PROCESSING_ATTEMPTS,
): Promise<WebhookWorkerHealthSnapshot> {
  const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const rows = await db.$queryRaw<
    Array<{
      pendingCount: bigint;
      processingCount: bigint;
      staleProcessingCount: bigint;
      failedCount: bigint;
      exhaustedCount: bigint;
      oldestPendingReceivedAt: Date | null;
    }>
  >`
    SELECT
      SUM(processing_status = 'PENDING') AS pendingCount,
      SUM(processing_status = 'PROCESSING') AS processingCount,
      SUM(processing_status = 'PROCESSING' AND locked_at < ${staleCutoff}) AS staleProcessingCount,
      SUM(processing_status = 'FAILED') AS failedCount,
      SUM(processing_attempts >= ${maxAttempts} AND processing_status <> 'PROCESSED') AS exhaustedCount,
      MIN(CASE WHEN processing_status = 'PENDING' THEN received_at ELSE NULL END) AS oldestPendingReceivedAt
    FROM webhook_events
  `;
  const row = rows[0];
  return {
    pendingCount: Number(row?.pendingCount ?? 0),
    processingCount: Number(row?.processingCount ?? 0),
    staleProcessingCount: Number(row?.staleProcessingCount ?? 0),
    failedCount: Number(row?.failedCount ?? 0),
    exhaustedCount: Number(row?.exhaustedCount ?? 0),
    oldestPendingReceivedAt: row?.oldestPendingReceivedAt ?? null,
  };
}

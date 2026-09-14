import type {
  PaymentAttempt,
  PaymentAttemptStatus,
  Refund,
  RefundStatus,
} from "@prisma/client";

import type {
  CreateRefundParams,
  CreateRefundResult,
  InitializeTransactionParams,
  InitializeTransactionResult,
  VerifyTransactionResult,
} from "@/src/integrations/paystack/types";

/**
 * Safe, client-returnable projections and the injectable Paystack-client
 * seam: the *interface* is defined here, by the owning module; the
 * *default, real implementation* lives in the integration file
 * (`src/integrations/paystack/client.ts`), imported by name. Tests inject
 * a fake object satisfying this same interface
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §28.4) — never a mocked HTTP
 * layer underneath a real client.
 */
export interface PaystackClient {
  initializeTransaction(
    params: InitializeTransactionParams,
  ): Promise<InitializeTransactionResult>;
  verifyTransaction(reference: string): Promise<VerifyTransactionResult>;
  createRefund(params: CreateRefundParams): Promise<CreateRefundResult>;
}

export interface PaymentAttemptRecord {
  id: string;
  orderId: string;
  paystackReference: string;
  amountMinor: number;
  currency: string;
  status: PaymentAttemptStatus;
  channel: string | null;
  authorizationUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  refundedAmountMinor: number;
  pendingRefundAmountMinor: number;
  availableRefundableAmountMinor: number | null;
  paidAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPaymentAttemptRecord(
  attempt: PaymentAttempt,
): PaymentAttemptRecord {
  return {
    id: attempt.id.toString(),
    orderId: attempt.orderId.toString(),
    paystackReference: attempt.paystackReference,
    amountMinor: attempt.amountMinor,
    currency: attempt.currency,
    status: attempt.status,
    channel: attempt.channel,
    authorizationUrl: attempt.authorizationUrl,
    errorCode: attempt.errorCode,
    errorMessage: attempt.errorMessage,
    refundedAmountMinor: attempt.refundedAmountMinor,
    pendingRefundAmountMinor: attempt.pendingRefundAmountMinor,
    availableRefundableAmountMinor: attempt.availableRefundableAmountMinor,
    paidAt: attempt.paidAt?.toISOString() ?? null,
    failedAt: attempt.failedAt?.toISOString() ?? null,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

export interface RefundRecord {
  id: string;
  paymentAttemptId: string;
  orderId: string;
  amountMinor: number;
  status: RefundStatus;
  reason: string | null;
  requestedBy: string;
  requestedAt: string;
  processedAt: string | null;
}

export function toRefundRecord(refund: Refund): RefundRecord {
  return {
    id: refund.id.toString(),
    paymentAttemptId: refund.paymentAttemptId.toString(),
    orderId: refund.orderId.toString(),
    amountMinor: refund.amountMinor,
    status: refund.status,
    reason: refund.reason,
    requestedBy: refund.requestedBy.toString(),
    requestedAt: refund.requestedAt.toISOString(),
    processedAt: refund.processedAt?.toISOString() ?? null,
  };
}

/** `initializePayment`'s result — mirrors what the checkout response
 * flow needs (plan §6.3/§8/§35 step 8): either a usable
 * `authorizationUrl`, or a disclosed initialization failure that does
 * NOT fail the surrounding order-creation response. */
export type InitializePaymentResult =
  | { outcome: "PENDING"; authorizationUrl: string; accessCode: string }
  | {
      outcome: "INITIALIZATION_FAILED";
      errorCode: string;
      errorMessage: string;
    };

/** Keyset ("cursor") pagination envelope — matches
 * `src/modules/order/types.ts`'s/`src/modules/inventory/types.ts`'s
 * `CursorPage<T>` shape exactly; not imported from either to keep every
 * module independent, the same small-duplication precedent Phase 4
 * already established (docs/PHASE_10_ADMIN_PLAN.md §14/§28.6 —
 * `listRefundsForAdmin` is this module's first paginated list). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

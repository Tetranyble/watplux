import {
  defaultPaystackClient,
  PaystackApiError,
} from "@/src/integrations/paystack/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PAYMENTS_REFUND } from "@/src/modules/payment/constants";
import * as paymentRepo from "@/src/modules/payment/repo";
import { toRefundRecord } from "@/src/modules/payment/types";
import type { PaystackClient, RefundRecord } from "@/src/modules/payment/types";
import type { RequestRefundInput } from "@/src/modules/payment/schema";

/**
 * Admin-only (plan §21/§22 — no customer-facing refund-request flow
 * exists anywhere in this module). Allocates first (plan §19's Allocate
 * transaction — the only place `pending_refund_amount_minor` changes at
 * request time), THEN calls Paystack's Create Refund API as a separate,
 * non-transactional step — never inside the allocation transaction (no
 * external call ever occurs inside a database transaction anywhere in
 * this module).
 */
export async function requestRefund(
  actor: AuthenticatedUser,
  paymentAttemptId: bigint,
  input: RequestRefundInput,
  paystackClient: PaystackClient = defaultPaystackClient,
): Promise<RefundRecord> {
  if (!actor.permissions.has(PERMISSION_PAYMENTS_REFUND)) {
    throw new ForbiddenError("You do not have permission to request a refund.");
  }

  const attempt = await paymentRepo.findAttemptById(paymentAttemptId);
  if (!attempt) {
    throw new NotFoundError("Payment attempt not found.");
  }
  if (attempt.status !== "SUCCESS") {
    throw new ValidationError(
      "Only a successful payment attempt can be refunded.",
    );
  }

  const amountMinor =
    input.amountMinor ?? attempt.availableRefundableAmountMinor ?? 0;
  if (amountMinor <= 0) {
    throw new ValidationError(
      "There is no refundable balance remaining on this payment attempt.",
    );
  }

  const refund = await paymentRepo.allocateRefund({
    paymentAttemptId,
    orderId: attempt.orderId,
    amountMinor,
    reason: input.reason ?? null,
    requestedBy: actor.id,
  });

  try {
    await paystackClient.createRefund({
      transactionReference: attempt.paystackReference,
      amountMinor,
      merchantNote: input.reason,
    });
    await paymentRepo.markRefundPending(refund.id);
  } catch (error) {
    // The Refund API call itself failed outright (plan §18) — release the
    // allocation immediately rather than leaving it pending forever.
    await paymentRepo.releaseRefund(refund.id, "REFUND_FAILED");
    const message =
      error instanceof PaystackApiError
        ? error.message
        : "Paystack refund request failed.";
    throw new ValidationError(`Refund request failed: ${message}`);
  }

  const updated = await paymentRepo.findRefundById(refund.id);
  if (!updated) {
    throw new NotFoundError("Refund not found.");
  }
  return toRefundRecord(updated);
}

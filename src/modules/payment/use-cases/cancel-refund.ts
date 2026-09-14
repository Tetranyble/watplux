import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PAYMENTS_REFUND } from "@/src/modules/payment/constants";
import * as paymentRepo from "@/src/modules/payment/repo";
import { toRefundRecord } from "@/src/modules/payment/types";
import type { RefundRecord } from "@/src/modules/payment/types";

/**
 * Admin deliberately aborts a refund request before Paystack confirms it
 * either way (plan §18) — a distinct terminal state (`REFUND_CANCELLED`)
 * from `REFUND_FAILED` (gateway/system failure), releasing the pending
 * allocation identically.
 */
export async function cancelRefund(
  actor: AuthenticatedUser,
  refundId: bigint,
): Promise<RefundRecord> {
  if (!actor.permissions.has(PERMISSION_PAYMENTS_REFUND)) {
    throw new ForbiddenError("You do not have permission to cancel a refund.");
  }

  await paymentRepo.releaseRefund(refundId, "REFUND_CANCELLED");

  const refund = await paymentRepo.findRefundById(refundId);
  if (!refund) {
    throw new NotFoundError("Refund not found.");
  }
  return toRefundRecord(refund);
}

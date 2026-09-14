import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import * as orderRepo from "@/src/modules/order/repo";
import { PERMISSION_PAYMENTS_READ } from "@/src/modules/payment/constants";
import * as paymentRepo from "@/src/modules/payment/repo";
import { toPaymentAttemptRecord } from "@/src/modules/payment/types";
import type { PaymentAttemptRecord } from "@/src/modules/payment/types";

/**
 * Ownership or `payments.read` (plan §21/§22) — the same IDOR-protection
 * template `get-user-profile.ts`/`get-order-by-id.ts` established:
 * `NotFoundError` (404) for a nonexistent order, `ForbiddenError` (403)
 * for an order that exists but isn't the caller's and the caller lacks
 * `payments.read`.
 */
export async function listPaymentAttemptsForOrder(
  actor: AuthenticatedUser,
  orderId: bigint,
): Promise<PaymentAttemptRecord[]> {
  const order = await orderRepo.findOrderById(orderId);
  if (!order) {
    throw new NotFoundError("Order not found.");
  }

  const isOwner = order.userId !== null && order.userId === actor.id;
  const canReadAnyPayment = actor.permissions.has(PERMISSION_PAYMENTS_READ);
  if (!isOwner && !canReadAnyPayment) {
    throw new ForbiddenError(
      "You cannot view payment attempts for this order.",
    );
  }

  const attempts = await paymentRepo.listAttemptsForOrder(orderId);
  return attempts.map(toPaymentAttemptRecord);
}

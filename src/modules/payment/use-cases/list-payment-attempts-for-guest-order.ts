import { ForbiddenError, NotFoundError } from "@/lib/errors";
import * as orderRepo from "@/src/modules/order/repo";
import * as paymentRepo from "@/src/modules/payment/repo";
import { toPaymentAttemptRecord } from "@/src/modules/payment/types";
import type { PaymentAttemptRecord } from "@/src/modules/payment/types";

/**
 * The guest-token-authorized counterpart to `listPaymentAttemptsForOrder`
 * (docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A) — takes no `actor` at
 * all, since a guest has no session. MUST only ever be called by a route
 * that has already independently verified a valid, unexpired,
 * correctly-scoped (matching THIS `orderId`) guest-order token — this
 * function itself re-checks `order.userId === null` as defense in depth,
 * so even a hypothetical bug in the token-issuing path can never let this
 * read an authenticated user's order data.
 */
export async function listPaymentAttemptsForGuestOrder(
  orderId: bigint,
): Promise<PaymentAttemptRecord[]> {
  const order = await orderRepo.findOrderById(orderId);
  if (!order) {
    throw new NotFoundError("Order not found.");
  }
  if (order.userId !== null) {
    throw new ForbiddenError("This order does not support guest access.");
  }

  const attempts = await paymentRepo.listAttemptsForOrder(orderId);
  return attempts.map(toPaymentAttemptRecord);
}

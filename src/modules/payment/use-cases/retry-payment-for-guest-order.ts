import { defaultPaystackClient } from "@/src/integrations/paystack/client";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import * as orderRepo from "@/src/modules/order/repo";
import { initializePayment } from "@/src/modules/payment/use-cases/initialize-payment";
import * as paymentRepo from "@/src/modules/payment/repo";
import type {
  InitializePaymentResult,
  PaystackClient,
} from "@/src/modules/payment/types";

const RETRY_ELIGIBLE_STATUSES = new Set([
  "FAILED",
  "ABANDONED",
  "INITIALIZATION_FAILED",
]);

/**
 * The guest-token-authorized counterpart to `retryPayment`
 * (docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A) — same eligibility
 * rules and same "new attempt against the existing order, never a new
 * order/reservation" guarantee as the authenticated path, just without an
 * `actor`. MUST only ever be called by a route that has already
 * independently verified a valid, unexpired, correctly-scoped guest-order
 * token; re-checks `order.userId === null` here too, as defense in depth.
 */
export async function retryPaymentForGuestOrder(
  orderId: bigint,
  paystackClient: PaystackClient = defaultPaystackClient,
): Promise<InitializePaymentResult> {
  const order = await orderRepo.findOrderById(orderId);
  if (!order) {
    throw new NotFoundError("Order not found.");
  }
  if (order.userId !== null) {
    throw new ForbiddenError("This order does not support guest access.");
  }

  if (order.status !== "PENDING_PAYMENT") {
    throw new ConflictError("This order is not awaiting payment.");
  }

  const latestAttempt = await paymentRepo.findLatestAttemptForOrder(orderId);
  if (!latestAttempt || !RETRY_ELIGIBLE_STATUSES.has(latestAttempt.status)) {
    throw new ConflictError(
      "Payment can only be retried after the most recent attempt has failed, was abandoned, or failed to initialize.",
    );
  }

  const newAttempt = await paymentRepo.createRetryAttempt({
    orderId,
    amountMinor: order.totalMinor,
    currency: order.currency,
  });

  if (!order.guestEmail) {
    // Structurally unreachable (a guest order always has `guestEmail`,
    // required at checkout) but verified rather than assumed.
    throw new ConflictError("This order has no guest email on file.");
  }

  return initializePayment(newAttempt.id, order.guestEmail, paystackClient);
}

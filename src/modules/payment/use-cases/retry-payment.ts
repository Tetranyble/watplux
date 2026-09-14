import { defaultPaystackClient } from "@/src/integrations/paystack/client";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_ORDERS_UPDATE } from "@/src/modules/order/constants";
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
 * Creates a NEW `payment_attempts` row against an EXISTING order and
 * initializes it — never recreates the order, its items, or its
 * inventory reservation (plan §10). Ownership check mirrors
 * `cancelOrder`'s exact shape (`order/use-cases/cancel-order.ts`) — reuses
 * the existing `orders.update` permission, no new permission introduced.
 *
 * Guest retry is not supported this phase — the same already-disclosed,
 * pre-existing "guest post-checkout order lookup" limitation Phase 6/7
 * both carry forward unchanged applies identically here.
 */
export async function retryPayment(
  actor: AuthenticatedUser,
  orderId: bigint,
  paystackClient: PaystackClient = defaultPaystackClient,
): Promise<InitializePaymentResult> {
  const order = await orderRepo.findOrderById(orderId);
  if (!order) {
    throw new NotFoundError("Order not found.");
  }

  const isOwner = order.userId !== null && order.userId === actor.id;
  const canManageAnyOrder = actor.permissions.has(PERMISSION_ORDERS_UPDATE);
  if (!isOwner && !canManageAnyOrder) {
    throw new ForbiddenError("You cannot retry payment for this order.");
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

  const email = order.guestEmail ?? actor.email;
  return initializePayment(newAttempt.id, email, paystackClient);
}

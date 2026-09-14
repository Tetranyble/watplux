import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_ORDERS_READ } from "@/src/modules/order/constants";
import * as orderRepo from "@/src/modules/order/repo";
import { toOrderDetail } from "@/src/modules/order/types";
import type { OrderDetail } from "@/src/modules/order/types";

/**
 * The IDOR-protection template `src/modules/auth/use-cases/get-user-profile.ts`
 * established: ownership OR elevated permission, resolved server-side
 * against the row actually fetched. `NotFoundError` (404) for a
 * nonexistent order; `ForbiddenError` (403) for an order that exists but
 * isn't the caller's and the caller lacks `orders.read`
 * (docs/PHASE_6_ORDER_PLAN.md §16/§17).
 */
export async function getOrderById(
  actor: AuthenticatedUser,
  orderId: bigint,
): Promise<OrderDetail> {
  const order = await orderRepo.findOrderById(orderId);
  if (!order) {
    throw new NotFoundError("Order not found.");
  }

  const isOwner = order.userId !== null && order.userId === actor.id;
  const canReadAnyOrder = actor.permissions.has(PERMISSION_ORDERS_READ);

  if (!isOwner && !canReadAnyOrder) {
    throw new ForbiddenError("You cannot view this order.");
  }

  return toOrderDetail(order);
}

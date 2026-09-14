import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_ORDERS_READ } from "@/src/modules/order/constants";
import * as orderRepo from "@/src/modules/order/repo";
import { toOrderDetail } from "@/src/modules/order/types";
import type { OrderDetail } from "@/src/modules/order/types";

/** Same ownership/permission template as `get-order-by-id.ts` — useful for
 * a post-checkout confirmation redirect that only has the order number,
 * not the numeric id (docs/PHASE_6_ORDER_PLAN.md §19). Only handles the
 * authenticated case; guest post-checkout lookup is an explicitly open
 * question (plan §17/§25), not solved here. */
export async function getOrderByOrderNumber(
  actor: AuthenticatedUser,
  orderNumber: string,
): Promise<OrderDetail> {
  const order = await orderRepo.findOrderByOrderNumber(orderNumber);
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

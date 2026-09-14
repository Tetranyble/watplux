import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_ORDERS_READ } from "@/src/modules/order/constants";
import * as orderRepo from "@/src/modules/order/repo";
import { toOrderDetail } from "@/src/modules/order/types";
import type { OrderDetail } from "@/src/modules/order/types";

/** Admin full-detail read — `orders.read`, no ownership fallback needed
 * since this is inherently the elevated-access path
 * (docs/PHASE_6_ORDER_PLAN.md §16/§19). */
export async function getOrderForAdmin(
  actor: AuthenticatedUser,
  orderId: bigint,
): Promise<OrderDetail> {
  requirePermission(actor, PERMISSION_ORDERS_READ);

  const order = await orderRepo.findOrderById(orderId);
  if (!order) {
    throw new NotFoundError("Order not found.");
  }

  return toOrderDetail(order);
}

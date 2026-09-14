import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_ORDERS_READ } from "@/src/modules/order/constants";
import * as orderRepo from "@/src/modules/order/repo";
import type { OrderMetrics } from "@/src/modules/order/repo";

export type { OrderMetrics };

/** Admin dashboard read (docs/PHASE_10_ADMIN_PLAN.md §9) — `orders.read`,
 * same permission the existing admin order list/detail reads already
 * require. Read-only, no mutation. */
export async function getOrderMetrics(
  actor: AuthenticatedUser,
): Promise<OrderMetrics> {
  requirePermission(actor, PERMISSION_ORDERS_READ);
  return orderRepo.getOrderMetrics();
}

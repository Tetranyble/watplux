import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_ORDERS_READ } from "@/src/modules/order/constants";
import * as orderRepo from "@/src/modules/order/repo";
import { toOrderSummary } from "@/src/modules/order/types";
import type { ListOrdersForAdminInput } from "@/src/modules/order/schema";
import type { CursorPage, OrderSummary } from "@/src/modules/order/types";

/** `orders.read`, optionally filtered by status
 * (docs/PHASE_6_ORDER_PLAN.md §16/§19) — reuses
 * `idx_orders_status_created` when `status` is supplied. */
export async function listOrdersForAdmin(
  actor: AuthenticatedUser,
  input: ListOrdersForAdminInput,
): Promise<CursorPage<OrderSummary>> {
  requirePermission(actor, PERMISSION_ORDERS_READ);

  const cursor = input.cursor
    ? orderRepo.decodeOrderListCursor(input.cursor)
    : null;

  const { rows, nextCursor } = await orderRepo.listOrdersForAdmin({
    status: input.status,
    cursor: cursor ?? undefined,
    limit: input.limit,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    orderNumber: input.orderNumber,
    customerEmail: input.customerEmail,
  });

  return { items: rows.map(toOrderSummary), nextCursor };
}

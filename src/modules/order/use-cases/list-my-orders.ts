import type { AuthenticatedUser } from "@/src/modules/auth/types";
import * as orderRepo from "@/src/modules/order/repo";
import { toOrderSummary } from "@/src/modules/order/types";
import type { ListMyOrdersInput } from "@/src/modules/order/schema";
import type { CursorPage, OrderSummary } from "@/src/modules/order/types";

/** No permission check — every authenticated user may list their own
 * orders; scoped by `userId = actor.id` at the repo layer
 * (docs/PHASE_6_ORDER_PLAN.md §16/§19). */
export async function listMyOrders(
  actor: AuthenticatedUser,
  input: ListMyOrdersInput,
): Promise<CursorPage<OrderSummary>> {
  const cursor = input.cursor
    ? orderRepo.decodeOrderListCursor(input.cursor)
    : null;

  const { rows, nextCursor } = await orderRepo.listOrdersForUser(
    actor.id,
    cursor ?? undefined,
    input.limit,
  );

  return { items: rows.map(toOrderSummary), nextCursor };
}

import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_ORDERS_UPDATE } from "@/src/modules/order/constants";
import { nextState } from "@/src/modules/order/domain/order-state-machine";
import * as orderRepo from "@/src/modules/order/repo";
import { toOrderDetail } from "@/src/modules/order/types";
import type { CancelOrderInput } from "@/src/modules/order/schema";
import type { OrderDetail } from "@/src/modules/order/types";

/**
 * `PENDING_PAYMENT -> CANCELLED`, adopted for this phase
 * (docs/PHASE_6_ORDER_PLAN.md §10): the owning customer (ownership check,
 * no permission needed) or any staff/admin holding `orders.update` (no
 * new permission — that key is already seeded).
 *
 * `actorType` is derived from *ownership*, not from which permission the
 * actor happens to hold: cancelling your own order is always a `SYSTEM`
 * (self) action per the plan's actor-mapping table, even if you also
 * hold `orders.update`; cancelling someone else's order (only reachable
 * via `orders.update`) is always `ADMIN`.
 */
export async function cancelOrder(
  actor: AuthenticatedUser,
  orderId: bigint,
  input: CancelOrderInput,
): Promise<OrderDetail> {
  const existing = await orderRepo.findOrderById(orderId);
  if (!existing) {
    throw new NotFoundError("Order not found.");
  }

  const isOwner = existing.userId !== null && existing.userId === actor.id;
  const canCancelAnyOrder = actor.permissions.has(PERMISSION_ORDERS_UPDATE);
  if (!isOwner && !canCancelAnyOrder) {
    throw new ForbiddenError("You cannot cancel this order.");
  }

  // Fast, friendly pre-check using the pure state machine against the
  // status already fetched above — cheap rejection for the common,
  // non-racing case (e.g. trying to cancel a DELIVERED order). The
  // authoritative, race-safe guard remains `orderRepo.cancelOrder`'s own
  // conditional UPDATE (plan §10/§20), which this check does not replace.
  //
  // Deliberately skipped when the order is already `CANCELLED`: that is
  // exactly the case `orderRepo.cancelOrder`'s own guard-failure recheck
  // treats as an idempotent success (plan §10's "belt-and-suspenders"
  // idempotency layer), not an error — `nextState("CANCELLED", "CANCEL")`
  // is `null` (CANCELLED has no outgoing transitions), so without this
  // exclusion every duplicate cancel call would be rejected here before
  // ever reaching repo's idempotent handling. Found via integration
  // testing, not by inspection.
  if (
    existing.status !== "CANCELLED" &&
    nextState(existing.status, "CANCEL") === null
  ) {
    throw new ValidationError(
      `An order in status "${existing.status}" cannot be cancelled.`,
    );
  }

  const order = await orderRepo.cancelOrder({
    orderId,
    actorType: isOwner ? "SYSTEM" : "ADMIN",
    actorId: actor.id,
    note: input.note,
  });

  return toOrderDetail(order);
}

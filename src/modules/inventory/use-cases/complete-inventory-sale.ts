import * as inventoryRepo from "@/src/modules/inventory/repo";
import { toInventoryMovementRecord } from "@/src/modules/inventory/types";
import type { CompleteInventorySaleInput } from "@/src/modules/inventory/schema";
import type { InventoryMovementRecord } from "@/src/modules/inventory/types";

/**
 * Inter-module contract (docs/PHASE_5_INVENTORY_PLAN.md §9/§15/§16) — no
 * `actor`, no permission check, no HTTP route, never calls Paystack,
 * never inspects a `payment_attempt`. Called by a future payment-webhook
 * worker only *after* its own conditional order-status
 * `PENDING_PAYMENT -> PAID` `UPDATE` has confirmed this is the first time
 * this order is transitioning — an independent, second idempotency layer
 * on top of this function's own (§16/§14).
 *
 * The quantity sold is derived from the order item's existing `RESERVE`
 * movement, never independently supplied.
 *
 * Idempotent: a duplicate call for the same `orderItemId` returns the
 * existing `SALE` movement rather than double-deducting (§7/§14).
 */
export async function completeInventorySale(
  input: CompleteInventorySaleInput,
): Promise<InventoryMovementRecord> {
  const movement = await inventoryRepo.completeInventorySale({
    orderItemId: input.orderItemId,
  });

  return toInventoryMovementRecord(movement);
}

import * as inventoryRepo from "@/src/modules/inventory/repo";
import { toInventoryMovementRecord } from "@/src/modules/inventory/types";
import type { ReleaseInventoryInput } from "@/src/modules/inventory/schema";
import type { InventoryMovementRecord } from "@/src/modules/inventory/types";

/**
 * Inter-module contract (docs/PHASE_5_INVENTORY_PLAN.md §9/§15) — no
 * `actor`, no permission check, no HTTP route. Called by a future
 * order-cancellation/TTL-sweep use-case. The quantity to release is
 * derived from the order item's existing `RESERVE` movement, never
 * independently supplied by the caller — eliminating a whole class of
 * mismatch bugs (§6/§7 of the plan).
 *
 * Idempotent: a duplicate call for the same `orderItemId` returns the
 * existing `RELEASE` movement rather than double-releasing (§7/§14).
 */
export async function releaseInventory(
  input: ReleaseInventoryInput,
): Promise<InventoryMovementRecord> {
  const movement = await inventoryRepo.releaseInventory({
    orderItemId: input.orderItemId,
  });

  return toInventoryMovementRecord(movement);
}

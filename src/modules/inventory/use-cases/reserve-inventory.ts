import { Prisma } from "@prisma/client";

import * as inventoryRepo from "@/src/modules/inventory/repo";
import { toInventoryMovementRecord } from "@/src/modules/inventory/types";
import type { ReserveInventoryInput } from "@/src/modules/inventory/schema";
import type { InventoryMovementRecord } from "@/src/modules/inventory/types";

/**
 * Inter-module contract (docs/PHASE_5_INVENTORY_PLAN.md §9/§15) — no
 * `actor`, no permission check, no HTTP route. Called by a future
 * checkout use-case as one step of its own order-creation transaction;
 * exercised standalone by this phase's own integration tests.
 *
 * `repo.ts` verifies the order item exists AND belongs to the exact
 * variant being mutated before any inventory mutation — the FK on
 * `inventory_movements.order_item_id` only proves the referenced row
 * exists, never that it names this variant (a correction identified
 * during implementation review, not part of the originally approved
 * plan — see docs/PHASE_5_INVENTORY_IMPLEMENTATION.md). A mismatch
 * throws before any write and rolls back the whole transaction.
 *
 * Idempotent: a duplicate call for the same `orderItemId` returns the
 * existing `RESERVE` movement rather than double-reserving (§7/§14).
 */
export async function reserveInventory(
  input: ReserveInventoryInput,
): Promise<InventoryMovementRecord> {
  const movement = await inventoryRepo.reserveInventory({
    orderItemId: input.orderItemId,
    variantId: input.variantId,
    quantity: new Prisma.Decimal(input.quantity),
  });

  return toInventoryMovementRecord(movement);
}

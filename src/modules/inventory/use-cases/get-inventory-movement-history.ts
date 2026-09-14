import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_INVENTORY_READ } from "@/src/modules/inventory/constants";
import * as inventoryRepo from "@/src/modules/inventory/repo";
import { toInventoryMovementRecord } from "@/src/modules/inventory/types";
import type { MovementHistoryInput } from "@/src/modules/inventory/schema";
import type {
  CursorPage,
  InventoryMovementRecord,
} from "@/src/modules/inventory/types";

/** Newest-first, keyset-paginated ledger view for one inventory item
 * (docs/PHASE_5_INVENTORY_PLAN.md §19), using the existing
 * `(inventory_item_id, created_at)` index. */
export async function getInventoryMovementHistory(
  actor: AuthenticatedUser,
  inventoryItemId: bigint,
  input: MovementHistoryInput,
): Promise<CursorPage<InventoryMovementRecord>> {
  requirePermission(actor, PERMISSION_INVENTORY_READ);

  const item = await inventoryRepo.findInventoryItemById(inventoryItemId);
  if (!item) {
    throw new NotFoundError("Inventory item not found.");
  }

  const cursor = input.cursor
    ? inventoryRepo.decodeMovementCursor(input.cursor)
    : null;

  const { rows, nextCursor } = await inventoryRepo.listMovementsForItem(
    inventoryItemId,
    cursor ?? undefined,
    input.limit,
  );

  return { items: rows.map(toInventoryMovementRecord), nextCursor };
}

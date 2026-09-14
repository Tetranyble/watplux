import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_INVENTORY_READ } from "@/src/modules/inventory/constants";
import * as inventoryRepo from "@/src/modules/inventory/repo";
import { toInventoryBalance } from "@/src/modules/inventory/types";
import type { ListInventoryInput } from "@/src/modules/inventory/schema";
import type {
  CursorPage,
  InventoryBalance,
} from "@/src/modules/inventory/types";

/** Keyset-paginated (docs/PHASE_5_INVENTORY_PLAN.md §19), optionally
 * filtered to low-stock items only (`quantity_available <= low_stock_threshold`). */
export async function listInventory(
  actor: AuthenticatedUser,
  input: ListInventoryInput,
): Promise<CursorPage<InventoryBalance>> {
  requirePermission(actor, PERMISSION_INVENTORY_READ);

  const cursor = input.cursor
    ? inventoryRepo.decodeIdCursor(input.cursor)
    : null;

  const { rows, nextCursor } = await inventoryRepo.listInventoryItems({
    lowStockOnly: input.lowStockOnly,
    cursor: cursor ?? undefined,
    limit: input.limit,
  });

  return { items: rows.map(toInventoryBalance), nextCursor };
}

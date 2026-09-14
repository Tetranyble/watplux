import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_INVENTORY_READ } from "@/src/modules/inventory/constants";
import * as inventoryRepo from "@/src/modules/inventory/repo";

/** Admin dashboard read (docs/PHASE_10_ADMIN_PLAN.md §9) — `inventory.read`,
 * same permission `listInventory`'s own `lowStockOnly` filter already
 * requires; this is just its count-only counterpart. */
export async function getLowStockCount(
  actor: AuthenticatedUser,
): Promise<number> {
  requirePermission(actor, PERMISSION_INVENTORY_READ);
  return inventoryRepo.countLowStockItems();
}

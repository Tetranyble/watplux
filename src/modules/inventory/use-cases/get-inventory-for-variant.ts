import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_INVENTORY_READ } from "@/src/modules/inventory/constants";
import * as inventoryRepo from "@/src/modules/inventory/repo";
import { toInventoryBalance } from "@/src/modules/inventory/types";
import type { InventoryBalance } from "@/src/modules/inventory/types";

/** `NotFoundError` when no `InventoryItem` row exists yet — a real,
 * distinct state (docs/PHASE_5_INVENTORY_PLAN.md §1/§9), not an error in
 * the variant's own existence. */
export async function getInventoryForVariant(
  actor: AuthenticatedUser,
  variantId: bigint,
): Promise<InventoryBalance> {
  requirePermission(actor, PERMISSION_INVENTORY_READ);

  const item = await inventoryRepo.findInventoryItemByVariantId(variantId);
  if (!item) {
    throw new NotFoundError(
      "No inventory is tracked for this product variant yet.",
    );
  }
  return toInventoryBalance(item);
}

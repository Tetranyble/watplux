import * as inventoryRepo from "@/src/modules/inventory/repo";

/**
 * Framework-agnostic, unauthenticated helper for a future storefront's
 * "in stock"/"low stock" display (docs/PHASE_5_INVENTORY_PLAN.md §9) —
 * no `actor`, no permission check, deliberately returns only
 * `quantityAvailable`, never `quantityOnHand`/`quantityReserved` (internal
 * operational figures, not customer-facing). Returns `0` (not an error)
 * for a variant with no `InventoryItem` row yet — from a storefront's
 * point of view, "nothing tracked" and "nothing available" are the same
 * fact: don't offer it for sale.
 */
export async function getAvailableQuantity(variantId: bigint): Promise<number> {
  const item = await inventoryRepo.findInventoryItemByVariantId(variantId);
  if (!item || item.quantityAvailable === null) {
    return 0;
  }
  return item.quantityAvailable.toNumber();
}

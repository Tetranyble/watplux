import type { InventoryItem, InventoryMovement } from "@prisma/client";

/**
 * Safe, client-returnable projections — the only shapes any inventory
 * use-case is allowed to hand back to a caller (same convention as
 * `src/modules/catalog/types.ts`). BigInt ids are always stringified;
 * Prisma `Decimal` fields are always converted to plain `number` before
 * crossing this boundary (docs/PHASE_5_INVENTORY_PLAN.md §4 — this
 * conversion is display-only, never used for further arithmetic; every
 * calculation stays in `Decimal` up to the point of writing to the
 * database, per repo.ts).
 */

export interface InventoryBalance {
  id: string;
  productVariantId: string;
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number | null;
  lowStockThreshold: number | null;
  updatedAt: string;
}

export interface InventoryMovementRecord {
  id: string;
  inventoryItemId: string;
  type: "RESTOCK" | "RESERVE" | "RELEASE" | "SALE" | "RETURN" | "ADJUSTMENT";
  onHandDelta: number;
  reservedDelta: number;
  orderItemId: string | null;
  referenceType: "MANUAL" | "PURCHASE_ORDER" | null;
  referenceId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Keyset ("cursor") pagination envelope — matches
 * `src/modules/catalog/types.ts`'s `CursorPage<T>` shape exactly; not
 * imported from there to keep the two modules independent (the same
 * small-duplication precedent Phase 4 already established for its own
 * pure helpers). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

function decimalToNumber(value: { toNumber(): number } | null): number | null {
  return value === null ? null : value.toNumber();
}

export function toInventoryBalance(item: InventoryItem): InventoryBalance {
  return {
    id: item.id.toString(),
    productVariantId: item.productVariantId.toString(),
    quantityOnHand: item.quantityOnHand.toNumber(),
    quantityReserved: item.quantityReserved.toNumber(),
    quantityAvailable: decimalToNumber(item.quantityAvailable),
    lowStockThreshold: decimalToNumber(item.lowStockThreshold),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toInventoryMovementRecord(
  movement: InventoryMovement,
): InventoryMovementRecord {
  return {
    id: movement.id.toString(),
    inventoryItemId: movement.inventoryItemId.toString(),
    type: movement.type,
    onHandDelta: movement.onHandDelta.toNumber(),
    reservedDelta: movement.reservedDelta.toNumber(),
    orderItemId: movement.orderItemId?.toString() ?? null,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId?.toString() ?? null,
    note: movement.note,
    createdBy: movement.createdBy?.toString() ?? null,
    createdAt: movement.createdAt.toISOString(),
  };
}

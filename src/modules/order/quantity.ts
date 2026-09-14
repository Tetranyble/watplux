import { Prisma } from "@prisma/client";

/**
 * Small, deliberate duplication of
 * `src/modules/inventory/quantity.ts`'s precision/positivity predicates —
 * keeping the two modules independent, the exact precedent Phase 4/5
 * established (docs/PHASE_6_ORDER_PLAN.md §5 point 2). `order_items.quantity`
 * is the same `DECIMAL(12,3)` column shape as Inventory's quantity columns.
 */

const MAX_DECIMAL_PLACES = 3;

export function hasValidQuantityPrecision(value: number): boolean {
  return new Prisma.Decimal(value).decimalPlaces() <= MAX_DECIMAL_PLACES;
}

export function isPositiveQuantity(value: number): boolean {
  return new Prisma.Decimal(value).greaterThan(0);
}

export function isFiniteQuantity(value: number): boolean {
  return Number.isFinite(value);
}

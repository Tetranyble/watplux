import { Prisma } from "@prisma/client";

/**
 * Small, deliberate duplication of `src/modules/inventory/quantity.ts`'s
 * and `src/modules/order/quantity.ts`'s precision/positivity predicates —
 * keeping Cart independent, the exact precedent Phase 4/5/6 established
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §8). `cart_items.quantity` is the
 * same `DECIMAL(12,3)` column shape as Inventory's/Order's quantity
 * columns.
 *
 * Lives at the module root, not `domain/`, for the same Prisma-import-
 * boundary reason `order/quantity.ts` does: `repo.ts` needs to call these
 * from inside its guarded transactions, and `domain/` cannot be imported
 * by `repo.ts`.
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

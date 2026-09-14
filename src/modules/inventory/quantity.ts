import { Prisma } from "@prisma/client";

/**
 * Pure `DECIMAL(12,3)` quantity helpers — zero I/O.
 *
 * Deliberately lives at `src/modules/inventory/quantity.ts`, not
 * `domain/quantity.ts`, for the exact reason
 * `src/modules/catalog/slug.ts`/`default-variant.ts` were relocated
 * during Phase 4 (`docs/PHASE_4_CATALOG_IMPLEMENTATION.md` §3):
 * `repo.ts` needs to call these from inside its guarded transactions
 * (docs/PHASE_5_INVENTORY_PLAN.md §7/§12), and the pre-existing
 * `boundaries/dependencies` ESLint rule forbids `repo.ts` from importing
 * anything classified as `domain`. This plan (§22) placed it here from
 * the start rather than needing a later correction.
 *
 * Imports `Prisma.Decimal` (decimal.js) as a value, not the Prisma
 * client itself — this is arbitrary-precision arithmetic, not database
 * access, and does not conflict with "only repo.ts imports Prisma [the
 * client]" any more than `src/modules/catalog/types.ts` importing Prisma
 * *types* did in Phase 4.
 */

const MAX_DECIMAL_PLACES = 3;

/** True iff `value` has at most 3 fractional digits (docs/DATABASE_DESIGN.md
 * §19 — `DECIMAL(12,3)`, e.g. `2.5`/`2.500` valid, `2.5001` rejected). */
export function hasValidQuantityPrecision(value: number): boolean {
  return new Prisma.Decimal(value).decimalPlaces() <= MAX_DECIMAL_PLACES;
}

/** True iff `value` is strictly greater than zero — every quantity a
 * use-case accepts as a direct input (restock/reserve/release/sale/return
 * amount) must be positive; `0` is never a meaningful quantity to move. */
export function isPositiveQuantity(value: number): boolean {
  return new Prisma.Decimal(value).greaterThan(0);
}

/** True iff `value` is a finite number that could plausibly represent a
 * quantity at all (used ahead of the Decimal-specific checks above, so a
 * `NaN`/`Infinity` never reaches `Prisma.Decimal` construction). */
export function isFiniteQuantity(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * Computes the signed delta to apply when an admin supplies an absolute
 * target quantity rather than a direct delta (docs/PHASE_5_INVENTORY_PLAN.md
 * §7/§12's absolute-target adjustment path). Pure `Decimal` arithmetic —
 * never `Number(x) - Number(y)`. The caller is responsible for having
 * read `currentOnHand` under the `SELECT ... FOR UPDATE` lock (§7)
 * *before* calling this — this function itself performs no I/O and has
 * no way to enforce that.
 */
export function computeAdjustmentDelta(
  currentOnHand: Prisma.Decimal,
  targetOnHand: Prisma.Decimal,
): Prisma.Decimal {
  return targetOnHand.minus(currentOnHand);
}

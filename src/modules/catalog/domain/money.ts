/**
 * Pure integer-minor-unit money validation — zero I/O. Money is always a
 * non-negative integer count of the smallest currency unit (kobo for
 * NGN), never a float (project-wide rule, docs/ARCHITECTURE.md).
 */

export function isValidMinorUnitAmount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * `compareAtPriceMinor`, when supplied, must be `>= priceMinor` — a
 * "was" price lower than the current selling price can't mean anything
 * as a discount indicator and is rejected outright
 * (docs/PHASE_4_CATALOG_PLAN.md §10, correcting an earlier draft that
 * only warned instead of enforcing this). Equal is valid — a legitimate,
 * momentary display state per docs/DATABASE_DESIGN.md §4. `null`/`undefined`
 * is always valid regardless of `priceMinor`.
 */
export function isValidCompareAtPrice(
  priceMinor: number,
  compareAtPriceMinor: number | null | undefined,
): boolean {
  if (compareAtPriceMinor === null || compareAtPriceMinor === undefined) {
    return true;
  }
  return compareAtPriceMinor >= priceMinor;
}

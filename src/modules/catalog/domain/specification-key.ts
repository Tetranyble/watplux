/**
 * Pure specification-key normalization — zero I/O
 * (docs/PHASE_4_CATALOG_PLAN.md §8). Prevents "Cell Type", "cell_type",
 * and "cell-type " from becoming three different keys on different
 * products, which would otherwise silently defeat the one legitimate
 * cross-product benefit of the flat `product_specifications` table.
 * Idempotent: normalizing an already-normalized key is a no-op.
 */

const SPEC_KEY_SHAPE = /^[a-z0-9_]+$/;
const MAX_SPEC_KEY_LENGTH = 100;

export function normalizeSpecKey(rawKey: string): string {
  return (
    rawKey
      .trim()
      .toLowerCase()
      // Whitespace AND hyphens both collapse to underscore — "cell-type" and
      // "cell type" are the same near-duplicate-spelling problem this
      // function exists to close, per the module doc comment's own promise.
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
  );
}

export function isValidSpecKeyShape(value: string): boolean {
  return (
    SPEC_KEY_SHAPE.test(value) &&
    value.length > 0 &&
    value.length <= MAX_SPEC_KEY_LENGTH
  );
}

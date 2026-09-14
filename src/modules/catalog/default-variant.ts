/**
 * Pure "which variant should become the new default" selection — zero I/O.
 * Used by `archiveVariant` (docs/PHASE_4_CATALOG_PLAN.md §4) when the
 * variant being archived currently holds the product's default flag: the
 * remaining `ACTIVE` variants are read (inside the locked transaction,
 * §13a) and handed to this function to decide the replacement.
 *
 * Deliberately lives at `src/modules/catalog/default-variant.ts`, not
 * `domain/default-variant.ts` as originally sketched in §2's illustrative
 * layout — same reasoning as `slug.ts`'s relocation: `repo.ts` calls this
 * from inside its locked transaction, and the pre-existing
 * `boundaries/dependencies` ESLint rule forbids `repo.ts` from importing
 * anything classified as `domain`. See `slug.ts`'s comment and
 * docs/PHASE_4_CATALOG_IMPLEMENTATION.md for the full account.
 */
export interface VariantCandidate {
  id: bigint;
  sortOrder: number;
}

/** Lowest `sortOrder` first; ties broken by the smaller `id` (earliest
 * created). Returns `null` if there are no candidates at all — the caller
 * (`archiveVariant`) must then refuse the archive rather than leave the
 * product with zero `ACTIVE` variants. */
export function pickReplacementDefault(
  candidates: readonly VariantCandidate[],
): VariantCandidate | null {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    if (candidate.sortOrder !== best.sortOrder) {
      return candidate.sortOrder < best.sortOrder ? candidate : best;
    }
    return candidate.id < best.id ? candidate : best;
  });
}

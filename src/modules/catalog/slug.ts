/**
 * Pure slug generation and shape validation — zero I/O. Deliberately
 * lives at `src/modules/catalog/slug.ts`, not `domain/slug.ts` as
 * originally sketched in docs/PHASE_4_CATALOG_PLAN.md §2's illustrative
 * layout: `repo.ts` needs these functions inside its locked transactions
 * (§13a), and the pre-existing `boundaries/dependencies` ESLint rule
 * (`eslint.config.mjs`, unchanged since Phase 1) forbids `repo.ts` from
 * importing anything classified as `domain` (any module's `domain`
 * subfolder).
 * Moving the file one level up removes it from that classification
 * without changing its content, purity, or unit-test coverage — the
 * plan's illustrative sub-folder placement wasn't a reviewed
 * architectural decision for this specific conflict, whereas the
 * "repo.ts is data-access only" rule is pre-existing, enforced
 * infrastructure this implementation does not override. See
 * docs/PHASE_4_CATALOG_IMPLEMENTATION.md for the full account.
 * `domain/specification-key.ts` and `domain/money.ts` stay under
 * `domain/` since only `schema.ts` (unrestricted by this rule) needs them.
 */

const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;

/** Deterministic for a given input: lowercases, strips diacritics,
 * replaces runs of non-alphanumeric characters with a single hyphen,
 * trims leading/trailing hyphens. May return an empty string for input
 * with no alphanumeric characters at all (e.g. "™" or "***") — callers
 * must handle that case (docs/PHASE_4_CATALOG_PLAN.md's slug section
 * assumes a non-empty product/category/brand name, which Zod already
 * enforces upstream, but a name that is *entirely* symbols/punctuation
 * would still slugify to ""). */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICAL_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True iff `value` is already a valid slug shape: lowercase alphanumeric
 * segments separated by single hyphens, no leading/trailing/doubled
 * hyphens, no uppercase, no other characters. Used to validate an
 * explicit administrator-supplied slug (never applied to auto-generated
 * ones, which are trusted by construction since `slugify` produces this
 * exact shape). */
export function isValidSlugShape(value: string): boolean {
  return SLUG_SHAPE.test(value);
}

/** Appends `-2`, `-3`, ... for the automatic-slug-generation collision
 * path only (docs/PHASE_4_CATALOG_PLAN.md §11) — attempt 1 returns the
 * base slug unchanged. Never applied to an explicit administrator-supplied
 * slug, which takes the `ConflictError` path instead. */
export function suffixSlug(baseSlug: string, attempt: number): string {
  return attempt <= 1 ? baseSlug : `${baseSlug}-${attempt}`;
}

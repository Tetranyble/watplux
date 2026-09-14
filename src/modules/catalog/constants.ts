/** Product lifecycle states — mirrors `prisma/schema.prisma`'s
 * `ProductStatus` enum. Re-exported here (as plain string-literal
 * constants, not a Prisma value-import) so use-cases reference a named
 * constant instead of a bare string, matching `src/modules/auth/constants.ts`'s
 * convention for role names. */
export const PRODUCT_STATUS_DRAFT = "DRAFT";
export const PRODUCT_STATUS_ACTIVE = "ACTIVE";
export const PRODUCT_STATUS_ARCHIVED = "ARCHIVED";

/** Variant lifecycle states — mirrors `ProductVariantStatus`. */
export const VARIANT_STATUS_ACTIVE = "ACTIVE";
export const VARIANT_STATUS_ARCHIVED = "ARCHIVED";

/** Permission keys this module gates on (seeded in Phase 3,
 * `prisma/seed-data.ts`) — docs/PHASE_4_CATALOG_PLAN.md §9. Categories and
 * brands deliberately reuse these; they are not a separate resource in
 * the seeded permission list. */
export const PERMISSION_PRODUCTS_READ = "products.read";
export const PERMISSION_PRODUCTS_CREATE = "products.create";
export const PERMISSION_PRODUCTS_UPDATE = "products.update";
export const PERMISSION_PRODUCTS_DELETE = "products.delete";

/** Advisory (not enforced) list of specification keys already named in
 * docs/DATABASE_DESIGN.md §3's EAV discussion — a future admin UI can
 * offer these as autocomplete suggestions. `upsertProductSpecification`
 * accepts any normalized key outside this list; see
 * docs/PHASE_4_CATALOG_PLAN.md §8. */
export const KNOWN_SPEC_KEYS = [
  "cell_type",
  "cycle_life",
  "depth_of_discharge",
  "certifications",
  "warranty_terms",
  "input_voltage_range",
  "output_voltage",
  "surge_power_w",
  "battery_chemistry",
  "connector_type",
  "ip_rating",
  "operating_temperature_range",
] as const;

/** Default page size and hard cap for keyset-paginated catalog listings
 * (docs/PHASE_4_CATALOG_PLAN.md §16). */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Circuit-breaker bound for automatic slug-collision-suffix retries
 * (docs/PHASE_4_CATALOG_PLAN.md §11) — not an expected real-world path. */
export const MAX_SLUG_GENERATION_ATTEMPTS = 10;

/** Defensive bound on the category-hierarchy ancestor walk
 * (docs/PHASE_4_CATALOG_PLAN.md §5) — guards against a pre-existing data
 * corruption causing an infinite loop, not an expected/supported nesting
 * depth. */
export const MAX_CATEGORY_ANCESTOR_WALK_DEPTH = 20;

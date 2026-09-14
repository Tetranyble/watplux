/** Movement types — mirrors `prisma/schema.prisma`'s `InventoryMovementType`
 * enum exactly (docs/PHASE_5_INVENTORY_PLAN.md §3). Re-exported as plain
 * string-literal constants, not a Prisma value-import, matching
 * `src/modules/catalog/constants.ts`'s convention. Six types, no
 * `RECEIPT`, no `CANCELLATION` (both considered and rejected in
 * docs/DATABASE_DESIGN.md §5). */
export const MOVEMENT_TYPE_RESTOCK = "RESTOCK";
export const MOVEMENT_TYPE_RESERVE = "RESERVE";
export const MOVEMENT_TYPE_RELEASE = "RELEASE";
export const MOVEMENT_TYPE_SALE = "SALE";
export const MOVEMENT_TYPE_RETURN = "RETURN";
export const MOVEMENT_TYPE_ADJUSTMENT = "ADJUSTMENT";

/** Reference types — mirrors `InventoryMovementReferenceType`. */
export const REFERENCE_TYPE_MANUAL = "MANUAL";
export const REFERENCE_TYPE_PURCHASE_ORDER = "PURCHASE_ORDER";

/** Permission keys this module gates on — already seeded in Phase 3
 * (`prisma/seed-data.ts`), not introduced here
 * (docs/PHASE_5_INVENTORY_PLAN.md §10). No `inventory.reserve`/
 * `inventory.release`/`inventory.sale` exists or is needed — those three
 * operations are inter-module contract functions, never directly
 * human-authorized (§9/§15). */
export const PERMISSION_INVENTORY_READ = "inventory.read";
export const PERMISSION_INVENTORY_ADJUST = "inventory.adjust";

/** Default page size and hard cap for keyset-paginated inventory listings
 * and movement history, matching Phase 4's established convention. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Quantities are `DECIMAL(12,3)` everywhere in this domain
 * (docs/DATABASE_DESIGN.md §19) — three fractional digits, no more. */
export const QUANTITY_DECIMAL_PLACES = 3;

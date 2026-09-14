import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductSummary } from "@/src/modules/catalog/types";
import type { ListProductsInput } from "@/src/modules/catalog/schema";
import type { CursorPage, ProductSummary } from "@/src/modules/catalog/types";

/**
 * Public/customer read — no authentication, `ACTIVE`/`deletedAt: null`
 * only (docs/PHASE_4_CATALOG_PLAN.md §9). Keyset (cursor) pagination, not
 * offset (§16) — the cursor is opaque to the caller.
 */
export async function listProducts(
  input: ListProductsInput,
): Promise<CursorPage<ProductSummary>> {
  const cursor = input.cursor
    ? catalogRepo.decodeProductCursor(input.cursor)
    : null;

  const { rows, nextCursor } = await catalogRepo.listProductsPublic({
    categoryId: input.categoryId,
    brandId: input.brandId,
    featured: input.featured,
    search: input.search,
    cursor: cursor ?? undefined,
    limit: input.limit,
    minPriceMinor: input.minPriceMinor,
    maxPriceMinor: input.maxPriceMinor,
    powerRatingWMin: input.powerRatingWMin,
    powerRatingWMax: input.powerRatingWMax,
    voltageV: input.voltageV,
    phase: input.phase,
    inStockOnly: input.inStockOnly,
    sortBy: input.sortBy,
  });

  return { items: rows.map(toProductSummary), nextCursor };
}

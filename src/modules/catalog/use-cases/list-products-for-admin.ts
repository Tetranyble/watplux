import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_READ } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductSummary } from "@/src/modules/catalog/types";
import type { ListProductsForAdminInput } from "@/src/modules/catalog/schema";
import type { CursorPage, ProductSummary } from "@/src/modules/catalog/types";

/** Staff/admin read — every status, deleted rows included only when
 * explicitly requested (docs/PHASE_4_CATALOG_PLAN.md §9). */
export async function listProductsForAdmin(
  actor: AuthenticatedUser,
  input: ListProductsForAdminInput,
): Promise<CursorPage<ProductSummary>> {
  requirePermission(actor, PERMISSION_PRODUCTS_READ);

  const cursor = input.cursor
    ? catalogRepo.decodeProductCursor(input.cursor)
    : null;

  const { rows, nextCursor } = await catalogRepo.listProductsForAdmin({
    categoryId: input.categoryId,
    brandId: input.brandId,
    featured: input.featured,
    search: input.search,
    status: input.status,
    includeDeleted: input.includeDeleted,
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

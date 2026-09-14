import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogCategory } from "@/src/modules/catalog/types";
import type { CatalogCategory } from "@/src/modules/catalog/types";

/** Does not cascade-deactivate children or products — each level manages
 * its own visibility flag independently (docs/PHASE_4_CATALOG_PLAN.md §5). */
export async function deactivateCategory(
  actor: AuthenticatedUser,
  categoryId: bigint,
): Promise<CatalogCategory> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const existing = await catalogRepo.findCategoryById(categoryId);
  if (!existing) throw new NotFoundError("Category not found.");

  const updated = await catalogRepo.setCategoryActive(categoryId, false);
  return toCatalogCategory(updated);
}

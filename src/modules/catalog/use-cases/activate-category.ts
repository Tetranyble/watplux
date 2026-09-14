import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogCategory } from "@/src/modules/catalog/types";
import type { CatalogCategory } from "@/src/modules/catalog/types";

/** Not enumerated in §2's illustrative file list (which only names
 * `deactivate-category.ts`) but required by §5's prose
 * ("deactivateCategory/activateCategory") — the natural reverse
 * operation, not new scope. */
export async function activateCategory(
  actor: AuthenticatedUser,
  categoryId: bigint,
): Promise<CatalogCategory> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const existing = await catalogRepo.findCategoryById(categoryId);
  if (!existing) throw new NotFoundError("Category not found.");

  const updated = await catalogRepo.setCategoryActive(categoryId, true);
  return toCatalogCategory(updated);
}

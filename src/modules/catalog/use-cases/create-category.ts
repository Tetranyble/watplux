import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_CREATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogCategory } from "@/src/modules/catalog/types";
import type { CreateCategoryInput } from "@/src/modules/catalog/schema";
import type { CatalogCategory } from "@/src/modules/catalog/types";

/** No cycle check needed here (unlike `updateCategory`): a brand-new
 * category can't already be anyone's ancestor, so any existing parent is
 * safe to attach to — docs/PHASE_4_CATALOG_PLAN.md §5. Its existence is
 * still verified. */
export async function createCategory(
  actor: AuthenticatedUser,
  input: CreateCategoryInput,
): Promise<CatalogCategory> {
  requirePermission(actor, PERMISSION_PRODUCTS_CREATE);

  if (input.parentId) {
    const parent = await catalogRepo.findCategoryById(input.parentId);
    if (!parent) throw new NotFoundError("Parent category not found.");
  }

  const category = await catalogRepo.createCategory({
    name: input.name,
    slug: input.slug,
    description: input.description,
    imageUrl: input.imageUrl,
    parentId: input.parentId,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
  });

  return toCatalogCategory(category);
}

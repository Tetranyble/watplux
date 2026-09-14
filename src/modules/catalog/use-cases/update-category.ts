import { NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import {
  MAX_CATEGORY_ANCESTOR_WALK_DEPTH,
  PERMISSION_PRODUCTS_UPDATE,
} from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogCategory } from "@/src/modules/catalog/types";
import type { UpdateCategoryInput } from "@/src/modules/catalog/schema";
import type { CatalogCategory } from "@/src/modules/catalog/types";

/**
 * Rejects a reparent that would create a cycle (including the trivial
 * self-parenting case) via a bounded ancestor walk
 * (docs/PHASE_4_CATALOG_PLAN.md §5) — an application-transaction check,
 * since MySQL has no native mechanism to prevent a self-referencing FK
 * from forming a cycle.
 */
export async function updateCategory(
  actor: AuthenticatedUser,
  categoryId: bigint,
  input: UpdateCategoryInput,
): Promise<CatalogCategory> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const existing = await catalogRepo.findCategoryById(categoryId);
  if (!existing) throw new NotFoundError("Category not found.");

  if (input.parentId !== undefined && input.parentId !== null) {
    const parent = await catalogRepo.findCategoryById(input.parentId);
    if (!parent) throw new NotFoundError("Parent category not found.");

    const wouldCycle = await catalogRepo.wouldCreateCategoryCycle(
      categoryId,
      input.parentId,
      MAX_CATEGORY_ANCESTOR_WALK_DEPTH,
    );
    if (wouldCycle) {
      throw new ValidationError(
        "This reparent would create a cycle in the category hierarchy.",
      );
    }
  }

  const updated = await catalogRepo.updateCategory(categoryId, {
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

  return toCatalogCategory(updated);
}

import { ValidationError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import type { ReorderCategoriesInput } from "@/src/modules/catalog/schema";

/** Whole-list `sortOrder` rewrite, scoped to siblings (same `parentId`),
 * all-or-nothing in one transaction (docs/PHASE_4_CATALOG_PLAN.md §5).
 * Same exact-set validation as variant/image reordering. */
export async function reorderCategories(
  actor: AuthenticatedUser,
  input: ReorderCategoriesInput,
): Promise<void> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const currentIds = await catalogRepo.findCategoryIdsForSiblingSet(
    input.parentId,
  );
  const currentIdSet = new Set(currentIds.map((id) => id.toString()));
  const suppliedIdSet = new Set(input.categoryIds.map((id) => id.toString()));

  const isExactMatch =
    currentIdSet.size === suppliedIdSet.size &&
    [...currentIdSet].every((id) => suppliedIdSet.has(id));

  if (!isExactMatch) {
    throw new ValidationError(
      "The supplied category list must contain exactly this parent's current children, no more and no fewer.",
    );
  }

  await catalogRepo.reorderCategories(input.parentId, input.categoryIds);
}

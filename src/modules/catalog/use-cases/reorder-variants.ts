import { ValidationError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import type { ReorderVariantsInput } from "@/src/modules/catalog/schema";

/**
 * Whole-list `sortOrder` rewrite, all-or-nothing in one transaction
 * (docs/PHASE_4_CATALOG_PLAN.md §4). Validates that the supplied ID list
 * is exactly the product's current set of variant IDs — no more, no
 * fewer — before writing anything, so a stale or partial client-supplied
 * list can't silently drop a variant from the ordering or reference one
 * belonging to a different product.
 */
export async function reorderVariants(
  actor: AuthenticatedUser,
  input: ReorderVariantsInput,
): Promise<void> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const currentIds = await catalogRepo.findVariantIdsForProduct(
    input.productId,
  );
  const currentIdSet = new Set(currentIds.map((id) => id.toString()));
  const suppliedIdSet = new Set(input.variantIds.map((id) => id.toString()));

  const isExactMatch =
    currentIdSet.size === suppliedIdSet.size &&
    [...currentIdSet].every((id) => suppliedIdSet.has(id));

  if (!isExactMatch) {
    throw new ValidationError(
      "The supplied variant list must contain exactly the product's current variants, no more and no fewer.",
    );
  }

  await catalogRepo.reorderVariants(input.productId, input.variantIds);
}

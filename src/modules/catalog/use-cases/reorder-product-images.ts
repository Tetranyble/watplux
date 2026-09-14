import { ValidationError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import type { ReorderProductImagesInput } from "@/src/modules/catalog/schema";

/** Whole-list `sortOrder` rewrite, all-or-nothing in one transaction
 * (docs/PHASE_4_CATALOG_PLAN.md §7). Same exact-set validation as
 * `reorderVariants` — no more, no fewer than the product's current
 * images. */
export async function reorderProductImages(
  actor: AuthenticatedUser,
  input: ReorderProductImagesInput,
): Promise<void> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const currentIds = await catalogRepo.findImageIdsForProduct(input.productId);
  const currentIdSet = new Set(currentIds.map((id) => id.toString()));
  const suppliedIdSet = new Set(input.imageIds.map((id) => id.toString()));

  const isExactMatch =
    currentIdSet.size === suppliedIdSet.size &&
    [...currentIdSet].every((id) => suppliedIdSet.has(id));

  if (!isExactMatch) {
    throw new ValidationError(
      "The supplied image list must contain exactly the product's current images, no more and no fewer.",
    );
  }

  await catalogRepo.reorderProductImages(input.productId, input.imageIds);
}

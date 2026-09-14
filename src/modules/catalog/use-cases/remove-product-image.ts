import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";

/** Deletes the image; if it was primary, promotes the next by
 * `(sortOrder, id)` in the same transaction
 * (docs/PHASE_4_CATALOG_PLAN.md §7). */
export async function removeProductImage(
  actor: AuthenticatedUser,
  imageId: bigint,
): Promise<void> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  await catalogRepo.removeProductImage(imageId);
}

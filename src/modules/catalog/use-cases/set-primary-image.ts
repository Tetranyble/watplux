import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogImage } from "@/src/modules/catalog/types";
import type { CatalogImage } from "@/src/modules/catalog/types";

/** Unset-then-set transaction at the repo layer
 * (docs/PHASE_4_CATALOG_PLAN.md §7) — `isPrimary` has no database
 * uniqueness constraint, so this is what keeps "at most one primary
 * image per product" true in practice. */
export async function setPrimaryImage(
  actor: AuthenticatedUser,
  imageId: bigint,
): Promise<CatalogImage> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const updated = await catalogRepo.setPrimaryImage(imageId);
  return toCatalogImage(updated);
}

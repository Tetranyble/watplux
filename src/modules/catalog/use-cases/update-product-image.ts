import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogImage } from "@/src/modules/catalog/types";
import type { UpdateProductImageInput } from "@/src/modules/catalog/schema";
import type { CatalogImage } from "@/src/modules/catalog/types";

/** Never settable here: `isPrimary` — that goes through the dedicated
 * `setPrimaryImage` (docs/PHASE_4_CATALOG_PLAN.md §7). */
export async function updateProductImage(
  actor: AuthenticatedUser,
  imageId: bigint,
  input: UpdateProductImageInput,
): Promise<CatalogImage> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const existing = await catalogRepo.findImageById(imageId);
  if (!existing) throw new NotFoundError("Image not found.");

  const updated = await catalogRepo.updateProductImage(imageId, {
    altText: input.altText,
    width: input.width,
    height: input.height,
    sortOrder: input.sortOrder,
  });

  return toCatalogImage(updated);
}

import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_CREATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogImage } from "@/src/modules/catalog/types";
import type { AddProductImageInput } from "@/src/modules/catalog/schema";
import type { CatalogImage } from "@/src/modules/catalog/types";

/** Implements the primary-image invariant transactionally at the repo
 * layer (docs/PHASE_4_CATALOG_PLAN.md §7): the first image on a product
 * is always primary; a subsequent image defaults to non-primary unless
 * explicitly requested. */
export async function addProductImage(
  actor: AuthenticatedUser,
  input: AddProductImageInput,
): Promise<CatalogImage> {
  requirePermission(actor, PERMISSION_PRODUCTS_CREATE);

  const product = await catalogRepo.findProductById(input.productId);
  if (!product) throw new NotFoundError("Product not found.");

  const image = await catalogRepo.addProductImage({
    productId: input.productId,
    url: input.url,
    altText: input.altText,
    width: input.width,
    height: input.height,
    isPrimary: input.isPrimary,
    sortOrder: input.sortOrder,
  });

  return toCatalogImage(image);
}

import { NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_DELETE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductDetail } from "@/src/modules/catalog/types";
import type { ProductDetail } from "@/src/modules/catalog/types";

/**
 * Corrects an accidental soft delete (`deletedAt -> null`). Does not
 * change `status` — a restored product is whatever status it was before
 * deletion (typically `ARCHIVED`) and must still be explicitly published
 * to reappear on the storefront (docs/PHASE_4_CATALOG_PLAN.md §3). Not
 * enumerated in §2's illustrative file list but required by §3's
 * "Restore" row — a natural completion of the lifecycle, not new scope.
 */
export async function restoreProduct(
  actor: AuthenticatedUser,
  productId: bigint,
): Promise<ProductDetail> {
  requirePermission(actor, PERMISSION_PRODUCTS_DELETE);

  const existing = await catalogRepo.findProductById(productId);
  if (!existing) throw new NotFoundError("Product not found.");
  if (existing.deletedAt === null) {
    throw new ValidationError("This product has not been deleted.");
  }

  await catalogRepo.restoreProduct(productId);

  const product = await catalogRepo.findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  return toProductDetail(product);
}

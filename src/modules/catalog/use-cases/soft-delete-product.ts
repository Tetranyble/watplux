import { NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_DELETE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductDetail } from "@/src/modules/catalog/types";
import type { ProductDetail } from "@/src/modules/catalog/types";

/**
 * Soft-delete (`deletedAt` set), only permitted from `ARCHIVED`
 * (docs/PHASE_4_CATALOG_PLAN.md §3) — an admin can't soft-delete a live
 * product out from under active carts/PDPs without archiving it first.
 * Never a hard delete; `status` is untouched (an independent axis).
 */
export async function softDeleteProduct(
  actor: AuthenticatedUser,
  productId: bigint,
): Promise<ProductDetail> {
  requirePermission(actor, PERMISSION_PRODUCTS_DELETE);

  const existing = await catalogRepo.findProductById(productId);
  if (!existing) throw new NotFoundError("Product not found.");
  if (existing.status !== "ARCHIVED") {
    throw new ValidationError(
      "A product must be ARCHIVED before it can be deleted. Archive it first.",
    );
  }

  await catalogRepo.softDeleteProduct(productId);

  const product = await catalogRepo.findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  return toProductDetail(product);
}

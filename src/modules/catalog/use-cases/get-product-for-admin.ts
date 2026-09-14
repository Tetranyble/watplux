import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_READ } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductDetail } from "@/src/modules/catalog/types";
import type { ProductDetail } from "@/src/modules/catalog/types";

/**
 * Staff/admin read — every status, including `DRAFT`/`ARCHIVED`/
 * soft-deleted, every variant regardless of status
 * (docs/PHASE_4_CATALOG_PLAN.md §9). Physically separate from
 * `getProductBySlug`, never a shared flag-branched function.
 */
export async function getProductForAdmin(
  actor: AuthenticatedUser,
  productId: bigint,
): Promise<ProductDetail> {
  requirePermission(actor, PERMISSION_PRODUCTS_READ);

  const product = await catalogRepo.findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  return toProductDetail(product);
}

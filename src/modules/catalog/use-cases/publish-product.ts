import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductDetail } from "@/src/modules/catalog/types";
import type { ProductDetail } from "@/src/modules/catalog/types";

/**
 * `DRAFT`/`ARCHIVED` -> `ACTIVE`. `catalogRepo.publishProduct` does the
 * actual work inside a locked transaction (docs/PHASE_4_CATALOG_PLAN.md
 * §13a) — it re-validates the default-variant invariant against
 * post-lock state and throws `NotFoundError`/`ValidationError` itself;
 * this use-case only adds the permission gate.
 */
export async function publishProduct(
  actor: AuthenticatedUser,
  productId: bigint,
): Promise<ProductDetail> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  await catalogRepo.publishProduct(productId);

  const product = await catalogRepo.findProductById(productId);
  if (!product) {
    throw new Error("Product disappeared immediately after publishing.");
  }
  return toProductDetail(product);
}

import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductDetail } from "@/src/modules/catalog/types";
import type { ProductDetail } from "@/src/modules/catalog/types";

/** `ACTIVE` -> `ARCHIVED`, always allowed (docs/PHASE_4_CATALOG_PLAN.md
 * §3). Does not cascade-archive variants — each level manages its own
 * status independently. */
export async function archiveProduct(
  actor: AuthenticatedUser,
  productId: bigint,
): Promise<ProductDetail> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const existing = await catalogRepo.findProductById(productId);
  if (!existing) throw new NotFoundError("Product not found.");

  await catalogRepo.archiveProduct(productId);

  const product = await catalogRepo.findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  return toProductDetail(product);
}

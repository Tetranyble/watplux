import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogVariant } from "@/src/modules/catalog/types";
import type { CatalogVariant } from "@/src/modules/catalog/types";

/**
 * Replaces the product's default variant. `catalogRepo.setDefaultVariant`
 * acquires the product-row lock first (docs/PHASE_4_CATALOG_PLAN.md
 * §13a) and performs the exact unset-then-set ordering — this use-case
 * only adds the permission gate. `variantId` alone is enough input; the
 * product is derived server-side from the variant, never trusted from a
 * separately-supplied `productId` that could mismatch it.
 */
export async function setDefaultVariant(
  actor: AuthenticatedUser,
  variantId: bigint,
): Promise<CatalogVariant> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const updated = await catalogRepo.setDefaultVariant(variantId);
  return toCatalogVariant(updated);
}

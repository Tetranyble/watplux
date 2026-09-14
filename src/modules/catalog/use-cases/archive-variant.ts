import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogVariant } from "@/src/modules/catalog/types";
import type { CatalogVariant } from "@/src/modules/catalog/types";

/**
 * `catalogRepo.archiveVariant` acquires the product-row lock first
 * (docs/PHASE_4_CATALOG_PLAN.md §13a), re-reads the `ACTIVE` set against
 * that lock, throws `ValidationError` if this would leave zero `ACTIVE`
 * variants, and promotes a replacement default if the archived variant
 * held it. This use-case only adds the permission gate.
 */
export async function archiveVariant(
  actor: AuthenticatedUser,
  variantId: bigint,
): Promise<CatalogVariant> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const archived = await catalogRepo.archiveVariant(variantId);
  return toCatalogVariant(archived);
}

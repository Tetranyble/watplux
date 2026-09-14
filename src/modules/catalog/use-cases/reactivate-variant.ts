import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogVariant } from "@/src/modules/catalog/types";
import type { CatalogVariant } from "@/src/modules/catalog/types";

/**
 * `ARCHIVED -> ACTIVE`. Idempotent on an already-`ACTIVE` variant. Never
 * makes the variant the default — that stays exclusively an explicit
 * `setDefaultVariant` call. No product-row lock: this can only ever add
 * to the `ACTIVE` set, never violate the invariant
 * (docs/PHASE_4_CATALOG_PLAN.md §4/§13a).
 */
export async function reactivateVariant(
  actor: AuthenticatedUser,
  variantId: bigint,
): Promise<CatalogVariant> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const reactivated = await catalogRepo.reactivateVariant(variantId);
  return toCatalogVariant(reactivated);
}

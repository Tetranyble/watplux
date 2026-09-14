import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_READ } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogBrand } from "@/src/modules/catalog/types";
import type { CatalogBrand } from "@/src/modules/catalog/types";

/**
 * Admin-facing brand list — `products.read`, includes inactive brands
 * (`publicOnly=false`). `catalogRepo.listBrands` already accepted this
 * flag; the public `listBrands()` use-case simply never called it with
 * `false`. Phase 10 additive extension (docs/PHASE_10_ADMIN_PLAN.md
 * §10/§28.4) — no new repo logic.
 */
export async function listBrandsForAdmin(
  actor: AuthenticatedUser,
): Promise<CatalogBrand[]> {
  requirePermission(actor, PERMISSION_PRODUCTS_READ);

  const brands = await catalogRepo.listBrands(false);
  return brands.map(toCatalogBrand);
}

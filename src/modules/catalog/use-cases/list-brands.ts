import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogBrand } from "@/src/modules/catalog/types";
import type { CatalogBrand } from "@/src/modules/catalog/types";

/** Public/customer read — no authentication, `isActive` only
 * (docs/PHASE_4_CATALOG_PLAN.md §9). No pagination: brands are expected
 * to be a small, low-cardinality list at this catalog's scale (§16 does
 * not call for keyset pagination here, unlike products). */
export async function listBrands(): Promise<CatalogBrand[]> {
  const brands = await catalogRepo.listBrands(true);
  return brands.map(toCatalogBrand);
}

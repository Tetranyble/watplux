import { NotFoundError } from "@/lib/errors";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogBrand } from "@/src/modules/catalog/types";
import type { CatalogBrand } from "@/src/modules/catalog/types";

/**
 * Public/customer read (docs/PHASE_9_STOREFRONT_PLAN.md §31) — mirrors
 * `getProductBySlug`'s exact shape. No `actor`, no permission check.
 * Hard-codes `isActive: true` at the repo layer (`findBrandBySlugPublic`).
 */
export async function getBrandBySlug(slug: string): Promise<CatalogBrand> {
  const brand = await catalogRepo.findBrandBySlugPublic(slug);
  if (!brand) throw new NotFoundError("Brand not found.");
  return toCatalogBrand(brand);
}

import { NotFoundError } from "@/lib/errors";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogCategory } from "@/src/modules/catalog/types";
import type { CatalogCategory } from "@/src/modules/catalog/types";

/**
 * Public/customer read (docs/PHASE_9_STOREFRONT_PLAN.md §31) — mirrors
 * `getProductBySlug`'s exact shape. No `actor`, no permission check.
 * Hard-codes `isActive: true` at the repo layer
 * (`findCategoryBySlugPublic`) — there is no parameter an unauthenticated
 * caller could pass to see an inactive category.
 */
export async function getCategoryBySlug(
  slug: string,
): Promise<CatalogCategory> {
  const category = await catalogRepo.findCategoryBySlugPublic(slug);
  if (!category) throw new NotFoundError("Category not found.");
  return toCatalogCategory(category);
}

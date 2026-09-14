import type { MetadataRoute } from "next";

import {
  getCachedBrands,
  getCachedCategoryTree,
  getCachedProductListing,
} from "@/app/_data/catalog";
import { env } from "@/lib/env";

/**
 * docs/PHASE_9_STOREFRONT_PLAN.md §17 — every `ACTIVE`, non-deleted
 * product and every active category, generated from the same cached
 * catalog reads the pages themselves use (never a parallel "SEO data"
 * source). A single sitemap is sufficient at this catalog's current
 * scale; `MAX_SITEMAP_PRODUCTS` is a defensive cap, not a silent
 * truncation — a catalog that actually exceeds it needs a paginated
 * sitemap index instead (Next's `generateSitemaps`), a disclosed future
 * enhancement, not built here.
 */
const MAX_SITEMAP_PRODUCTS = 5000;

function flattenCategories(
  nodes: Awaited<ReturnType<typeof getCachedCategoryTree>>,
): Awaited<ReturnType<typeof getCachedCategoryTree>> {
  return nodes.flatMap((node) => [node, ...flattenCategories(node.children)]);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.APP_BASE_URL;

  const entries: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/products`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/consultation`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/installation`, changeFrequency: "monthly", priority: 0.5 },
  ];

  const categories = flattenCategories(await getCachedCategoryTree());
  for (const category of categories) {
    entries.push({
      url: `${base}/categories/${category.slug}`,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  const brands = await getCachedBrands();
  for (const brand of brands) {
    entries.push({
      url: `${base}/brands/${brand.slug}`,
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }

  let cursor: string | undefined;
  let productCount = 0;
  do {
    const page = await getCachedProductListing({
      limit: 100,
      featured: undefined,
      cursor,
    });
    for (const product of page.items) {
      entries.push({
        url: `${base}/products/${product.slug}`,
        lastModified: new Date(product.createdAt),
        changeFrequency: "weekly",
        priority: 0.7,
      });
      productCount += 1;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor && productCount < MAX_SITEMAP_PRODUCTS);

  return entries;
}

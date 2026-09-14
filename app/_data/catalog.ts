import { cacheLife, cacheTag, revalidateTag } from "next/cache";

import { getBrandBySlug } from "@/src/modules/catalog/use-cases/get-brand-by-slug";
import { getCategoryBySlug } from "@/src/modules/catalog/use-cases/get-category-by-slug";
import { getCategoryTree } from "@/src/modules/catalog/use-cases/get-category-tree";
import { getProductBySlug } from "@/src/modules/catalog/use-cases/get-product-by-slug";
import { listBrands } from "@/src/modules/catalog/use-cases/list-brands";
import { listProducts } from "@/src/modules/catalog/use-cases/list-products";
import type { ListProductsInput } from "@/src/modules/catalog/schema";

/**
 * The one place `"use cache"`/`cacheLife`/`cacheTag` are used in this
 * codebase (docs/PHASE_9_STOREFRONT_PLAN.md §8) — lives under `app/`
 * (not `src/modules/catalog/use-cases/`) deliberately: those use-cases
 * must stay framework-agnostic (no `next/*` import), matching the
 * project's existing convention that Next.js-aware seams live in `lib/`
 * or `app/**`, never inside a module's own use-case files. Every
 * function here is a thin cached wrapper around an already-existing,
 * already-tested public catalog use-case — no new business logic.
 *
 * Cache invalidation (`revalidateTag`) is called from the corresponding
 * admin catalog Route Handlers (`app/api/admin/catalog/**`), for the
 * identical reason — Route Handlers are `app/**` (presentation), the
 * one layer allowed to import `next/cache` alongside the use-case it
 * calls.
 */

export async function getCachedCategoryTree() {
  "use cache";
  cacheTag("catalog:categories");
  cacheLife("hours");
  return getCategoryTree();
}

export async function getCachedBrands() {
  "use cache";
  cacheTag("catalog:brands");
  cacheLife("hours");
  return listBrands();
}

export async function getCachedCategoryBySlug(slug: string) {
  "use cache";
  cacheTag("catalog:categories");
  cacheTag(`catalog:category:${slug}`);
  cacheLife("hours");
  return getCategoryBySlug(slug);
}

export async function getCachedBrandBySlug(slug: string) {
  "use cache";
  cacheTag("catalog:brands");
  cacheTag(`catalog:brand:${slug}`);
  cacheLife("hours");
  return getBrandBySlug(slug);
}

export async function getCachedProductListing(input: ListProductsInput) {
  "use cache";
  cacheTag("catalog:products");
  cacheLife("minutes");
  return listProducts(input);
}

/** Live-stock discovery must not sit behind the catalog listing cache. The
 * caller-facing helper keeps the public page API uniform while bypassing
 * caching only when the query depends on inventory availability. */
export async function getStorefrontProductListing(input: ListProductsInput) {
  if (input.inStockOnly) {
    return listProducts(input);
  }
  return getCachedProductListing(input);
}

export async function getCachedProductBySlug(slug: string) {
  "use cache";
  cacheTag("catalog:products");
  cacheTag(`catalog:product:${slug}`);
  cacheLife("hours");
  return getProductBySlug(slug);
}

// ---------------------------------------------------------------------------
// Invalidation — called from the admin catalog Route Handlers
// (app/api/admin/catalog/**) right after a mutating use-case succeeds.
// `revalidateTag`, not `updateTag`: these routes are plain Route Handlers,
// not Server Actions, and `updateTag` can only be called from a Server
// Action (Next 16 docs, confirmed against node_modules/next/dist/docs).
// `profile: "max"` per the current (non-deprecated) `revalidateTag` API —
// stale-while-revalidate, not an immediate blocking expiry.
// ---------------------------------------------------------------------------

/** A cache entry tagged with BOTH `catalog:products` and
 * `catalog:product:{slug}` (e.g. a PDP read) is invalidated by revalidating
 * EITHER tag — so busting the coarse `catalog:products` tag alone already
 * invalidates every product's PDP cache, not just listings. Variant/image/
 * specification mutations (which don't cheaply know their parent product's
 * slug without an extra query) rely on exactly this: they call
 * `revalidateCatalogProducts()` with no slug, which is still fully correct
 * (every PDP + every listing gets busted), just less granular than the
 * product-level mutations below, which also have the slug for free from
 * their own use-case's return value. */
export function revalidateCatalogProducts(slug?: string): void {
  revalidateTag("catalog:products", "max");
  if (slug) {
    revalidateTag(`catalog:product:${slug}`, "max");
  }
}

export function revalidateCatalogCategories(slug?: string): void {
  revalidateTag("catalog:categories", "max");
  // A category rename/reparent can affect listing breadcrumbs/filters.
  revalidateTag("catalog:products", "max");
  if (slug) {
    revalidateTag(`catalog:category:${slug}`, "max");
  }
}

export function revalidateCatalogBrands(slug?: string): void {
  revalidateTag("catalog:brands", "max");
  revalidateTag("catalog:products", "max");
  if (slug) {
    revalidateTag(`catalog:brand:${slug}`, "max");
  }
}

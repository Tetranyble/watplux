import Link from "next/link";
import type { Metadata } from "next";

import {
  getCachedBrands,
  getCachedCategoryTree,
  getStorefrontProductListing,
} from "@/app/_data/catalog";
import { ProductFilterForm } from "@/components/storefront/product-filter-form";
import { ProductGrid } from "@/components/storefront/product-grid";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import type { ListProductsInput } from "@/src/modules/catalog/schema";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const hasDiscoveryParams = Object.entries(params).some(
    ([key, value]) =>
      key !== "cursor" &&
      value !== undefined &&
      (Array.isArray(value) ? value.some(Boolean) : value !== ""),
  );
  return {
    title: "Shop",
    description: "Browse solar panels, inverters, batteries, and accessories.",
    alternates: { canonical: `${env.APP_BASE_URL}/products` },
    // Faceted/search result URLs are useful for customers but should not
    // compete with dedicated product/category/brand landing pages in the
    // index. Crawlers can still follow product links from them.
    robots: hasDiscoveryParams ? { index: false, follow: true } : undefined,
  };
}

// Reads `searchParams` (filters/sort/cursor) — inherently per-request,
// so this route is allowed to block rather than requiring a static/
// instant navigation (see app/products/[slug]/page.tsx).
export const instant = false;

function flattenCategories(
  nodes: Awaited<ReturnType<typeof getCachedCategoryTree>>,
): Awaited<ReturnType<typeof getCachedCategoryTree>> {
  return nodes.flatMap((node) => [node, ...flattenCategories(node.children)]);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const get = (key: string): string | undefined => {
    const value = rawParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const categorySlug = get("category");
  const brandSlug = get("brand");
  const search = get("search");
  const minPriceNaira = parsePositiveInt(get("minPrice"));
  const maxPriceNaira = parsePositiveInt(get("maxPrice"));
  const powerMin = parsePositiveInt(get("powerMin"));
  const powerMax = parsePositiveInt(get("powerMax"));
  const voltage = parsePositiveInt(get("voltage"));
  const phaseParam = get("phase");
  const phase =
    phaseParam === "SINGLE" || phaseParam === "THREE" ? phaseParam : undefined;
  const inStockOnly = get("inStock") === "true";
  const sortParam = get("sort");
  const sortBy =
    sortParam === "featured" ||
    sortParam === "price_asc" ||
    sortParam === "price_desc"
      ? sortParam
      : "newest";
  const cursor = get("cursor");

  const [categoryTree, brands] = await Promise.all([
    getCachedCategoryTree(),
    getCachedBrands(),
  ]);
  const categories = flattenCategories(categoryTree);

  const category =
    categorySlug && categorySlug !== "all"
      ? categories.find((c) => c.slug === categorySlug)
      : undefined;
  const brand =
    brandSlug && brandSlug !== "all"
      ? brands.find((b) => b.slug === brandSlug)
      : undefined;

  const filters: ListProductsInput = {
    limit: 24,
    featured: undefined,
    search,
    categoryId: category ? BigInt(category.id) : undefined,
    brandId: brand ? BigInt(brand.id) : undefined,
    minPriceMinor:
      minPriceNaira !== undefined ? minPriceNaira * 100 : undefined,
    maxPriceMinor:
      maxPriceNaira !== undefined ? maxPriceNaira * 100 : undefined,
    powerRatingWMin: powerMin,
    powerRatingWMax: powerMax,
    voltageV: voltage,
    phase,
    inStockOnly,
    sortBy,
    cursor,
  };

  const page = await getStorefrontProductListing(filters);

  const nextPageParams = new URLSearchParams(
    Object.entries(rawParams).flatMap(([key, value]) =>
      value === undefined || key === "cursor" ? [] : [[key, String(value)]],
    ),
  );
  if (page.nextCursor) {
    nextPageParams.set("cursor", page.nextCursor);
  }

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-8 md:grid-cols-[16rem_1fr]">
      <aside>
        <h2 className="mb-4 text-sm font-semibold">Filters</h2>
        <ProductFilterForm
          categories={categories}
          brands={brands}
          values={{
            category: categorySlug,
            brand: brandSlug,
            search,
            minPrice: get("minPrice"),
            maxPrice: get("maxPrice"),
            powerMin: get("powerMin"),
            powerMax: get("powerMax"),
            voltage: get("voltage"),
            phase: phaseParam,
            inStock: get("inStock"),
            sort: sortParam,
          }}
        />
      </aside>

      <div>
        <h1 className="mb-6 text-2xl font-semibold">Shop</h1>
        <ProductGrid
          products={page.items}
          emptyMessage="No products match your filters. Try clearing some filters."
        />
        {page.nextCursor ? (
          <div className="mt-8 flex justify-center">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/products?${nextPageParams.toString()}`} />}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

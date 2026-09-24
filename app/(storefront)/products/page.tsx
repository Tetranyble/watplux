import Link from "next/link";
import type { Metadata } from "next";
import { PackageOpen, SearchX } from "lucide-react";

import {
  getCachedBrands,
  getCachedCategoryTree,
  getStorefrontProductListing,
} from "@/app/_data/catalog";
import {
  ProductFilterDrawer,
  ProductFilterForm,
  type ProductFilterValues,
} from "@/components/storefront/product-filter-form";
import { ProductGrid } from "@/components/storefront/product-grid";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import type { ListProductsInput } from "@/src/modules/catalog/schema";
import { copyValue, getSiteCopy, interpolateCopy } from "@/app/_data/site-copy";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const copy = await getSiteCopy();
  const hasDiscoveryParams = Object.entries(params).some(
    ([key, value]) =>
      key !== "cursor" &&
      value !== undefined &&
      (Array.isArray(value) ? value.some(Boolean) : value !== ""),
  );
  return {
    title: copyValue(copy, "catalog.metaTitle"),
    description: copyValue(copy, "catalog.metaDescription"),
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
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  const productsShown = (count: number, plus: boolean) =>
    interpolateCopy(c("catalog.productsShown"), {
      count,
      plus: plus ? "+" : "",
    });
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

  const filterValues: ProductFilterValues = {
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
  };
  const hasFilters = Boolean(
    search?.trim() ||
    (categorySlug && categorySlug !== "all") ||
    (brandSlug && brandSlug !== "all") ||
    minPriceNaira !== undefined ||
    maxPriceNaira !== undefined ||
    powerMin !== undefined ||
    powerMax !== undefined ||
    voltage !== undefined ||
    phase ||
    inStockOnly,
  );

  return (
    <div className="page-shell flex flex-1 flex-col py-8 sm:py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {c("catalog.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {c("catalog.description")}
          </p>
          {page.items.length > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground md:hidden">
              {productsShown(page.items.length, Boolean(page.nextCursor))}
            </p>
          ) : null}
        </div>
        <ProductFilterDrawer
          categories={categories}
          brands={brands}
          values={filterValues}
        />
      </header>

      <div className="mt-6 grid flex-1 gap-8 md:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden self-start md:sticky md:top-20 md:block">
          <ProductFilterForm
            categories={categories}
            brands={brands}
            values={filterValues}
          />
        </aside>

        <section
          className="flex min-w-0 flex-col"
          aria-label={c("catalog.resultsAria")}
        >
          {page.items.length > 0 ? (
            <div className="mb-4 hidden min-h-8 items-center justify-between gap-4 md:flex">
              <p className="text-sm text-muted-foreground">
                {productsShown(page.items.length, Boolean(page.nextCursor))}
              </p>
              {hasFilters ? (
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/products" />}
                >
                  {c("catalog.clearAll")}
                </Button>
              ) : null}
            </div>
          ) : null}

          <ProductGrid
            products={page.items}
            emptyIcon={hasFilters ? SearchX : PackageOpen}
            emptyTitle={
              hasFilters
                ? c("catalog.empty.filteredTitle")
                : c("catalog.empty.catalogTitle")
            }
            emptyMessage={
              hasFilters
                ? c("catalog.empty.filteredDescription")
                : c("catalog.empty.catalogDescription")
            }
            emptyAction={
              <Button
                variant={hasFilters ? "outline" : "default"}
                nativeButton={false}
                render={
                  <Link href={hasFilters ? "/products" : "/consultation"} />
                }
              >
                {hasFilters
                  ? c("catalog.empty.clear")
                  : c("catalog.empty.advice")}
              </Button>
            }
          />
          {page.nextCursor ? (
            <div className="mt-8 flex justify-center">
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link href={`/products?${nextPageParams.toString()}`} />
                }
              >
                {c("catalog.viewMore")}
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

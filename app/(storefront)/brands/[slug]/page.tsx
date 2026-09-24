import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Tag } from "lucide-react";

import {
  getCachedBrandBySlug,
  getCachedProductListing,
} from "@/app/_data/catalog";
import { ProductGrid } from "@/components/storefront/product-grid";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { isNotFoundError } from "@/lib/errors";
import { copyValue, getSiteCopy, interpolateCopy } from "@/app/_data/site-copy";

// See app/products/[slug]/page.tsx for why this is `false`.
export const instant = false;

async function loadBrand(slug: string) {
  try {
    return await getCachedBrandBySlug(slug);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const copy = await getSiteCopy();
  const brand = await loadBrand(slug);
  if (!brand) return {};
  // Brand has no seoTitle/seoDescription column (unlike Category/Product)
  // — a disclosed gap, docs/PHASE_9_STOREFRONT_PLAN.md §17 — so this
  // falls back to a templated title/description rather than a
  // schema-backed one.
  const title = interpolateCopy(copyValue(copy, "catalog.brand.metaTitle"), {
    brand: brand.name,
  });
  const description =
    brand.description ??
    interpolateCopy(copyValue(copy, "catalog.brand.metaDescription"), {
      brand: brand.name,
    });
  return {
    title,
    description,
    alternates: { canonical: `${env.APP_BASE_URL}/brands/${brand.slug}` },
    openGraph: { title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  const brand = await loadBrand(slug);
  if (!brand) {
    notFound();
  }

  const page = await getCachedProductListing({
    limit: 24,
    featured: undefined,
    brandId: BigInt(brand.id),
  });

  return (
    <div className="page-shell flex flex-1 flex-col py-10 sm:py-12 lg:py-14">
      <p className="eyebrow">{c("catalog.brand.eyebrow")}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {brand.name}
      </h1>
      {brand.description ? (
        <p className="mt-2 max-w-2xl text-muted-foreground">
          {brand.description}
        </p>
      ) : null}
      <div className="mt-8 flex flex-1 flex-col">
        <ProductGrid
          products={page.items}
          emptyIcon={Tag}
          emptyTitle={interpolateCopy(c("catalog.brand.emptyTitle"), {
            brand: brand.name,
          })}
          emptyMessage={c("catalog.brand.emptyDescription")}
          emptyAction={
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/consultation" />}
              >
                {c("catalog.collection.alternative")}
              </Button>
              <Button nativeButton={false} render={<Link href="/products" />}>
                {c("catalog.collection.allProducts")}
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}

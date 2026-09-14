import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  getCachedBrandBySlug,
  getCachedProductListing,
} from "@/app/_data/catalog";
import { ProductGrid } from "@/components/storefront/product-grid";
import { env } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";

// See app/products/[slug]/page.tsx for why this is `false`.
export const instant = false;

async function loadBrand(slug: string) {
  try {
    return await getCachedBrandBySlug(slug);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brand = await loadBrand(slug);
  if (!brand) return {};
  // Brand has no seoTitle/seoDescription column (unlike Category/Product)
  // — a disclosed gap, docs/PHASE_9_STOREFRONT_PLAN.md §17 — so this
  // falls back to a templated title/description rather than a
  // schema-backed one.
  const title = `${brand.name} products`;
  const description =
    brand.description ?? `Shop ${brand.name} solar equipment.`;
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
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{brand.name}</h1>
      {brand.description ? (
        <p className="mt-2 max-w-2xl text-muted-foreground">
          {brand.description}
        </p>
      ) : null}
      <div className="mt-8">
        <ProductGrid
          products={page.items}
          emptyMessage="No products from this brand yet."
        />
      </div>
    </div>
  );
}

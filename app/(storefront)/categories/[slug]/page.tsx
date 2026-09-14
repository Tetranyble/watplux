import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  getCachedCategoryBySlug,
  getCachedProductListing,
} from "@/app/_data/catalog";
import { ProductGrid } from "@/components/storefront/product-grid";
import { env } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";

// See app/products/[slug]/page.tsx for why this is `false` (no
// `generateStaticParams`, per-request slug lookup, matches the existing
// `app/account/page.tsx` convention).
export const instant = false;

async function loadCategory(slug: string) {
  try {
    return await getCachedCategoryBySlug(slug);
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
  const category = await loadCategory(slug);
  if (!category) return {};
  const title = category.seoTitle ?? category.name;
  const description =
    category.seoDescription ?? category.description ?? undefined;
  return {
    title,
    description,
    alternates: {
      canonical: `${env.APP_BASE_URL}/categories/${category.slug}`,
    },
    openGraph: { title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await loadCategory(slug);
  if (!category) {
    notFound();
  }

  const page = await getCachedProductListing({
    limit: 24,
    featured: undefined,
    categoryId: BigInt(category.id),
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{category.name}</h1>
      {category.description ? (
        <p className="mt-2 max-w-2xl text-muted-foreground">
          {category.description}
        </p>
      ) : null}
      <div className="mt-8">
        <ProductGrid
          products={page.items}
          emptyMessage="No products in this category yet."
        />
      </div>
    </div>
  );
}

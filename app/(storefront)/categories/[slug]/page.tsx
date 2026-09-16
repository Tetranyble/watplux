import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Boxes } from "lucide-react";

import {
  getCachedCategoryBySlug,
  getCachedProductListing,
} from "@/app/_data/catalog";
import { ProductGrid } from "@/components/storefront/product-grid";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { isNotFoundError } from "@/lib/errors";

// See app/products/[slug]/page.tsx for why this is `false` (no
// `generateStaticParams`, per-request slug lookup, matches the existing
// `app/account/page.tsx` convention).
export const instant = false;

async function loadCategory(slug: string) {
  try {
    return await getCachedCategoryBySlug(slug);
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
    <div className="page-shell flex flex-1 flex-col py-10 sm:py-12 lg:py-14">
      <p className="eyebrow">Product category</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {category.name}
      </h1>
      {category.description ? (
        <p className="mt-2 max-w-2xl text-muted-foreground">
          {category.description}
        </p>
      ) : null}
      <div className="mt-8 flex flex-1 flex-col">
        <ProductGrid
          products={page.items}
          emptyIcon={Boxes}
          emptyTitle={`No ${category.name} products yet`}
          emptyMessage="We’re still preparing this collection. Browse the full catalog or speak with our team for help finding the right equipment."
          emptyAction={
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/consultation" />}
              >
                Get product advice
              </Button>
              <Button nativeButton={false} render={<Link href="/products" />}>
                Browse all products
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}

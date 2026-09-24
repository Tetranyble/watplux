import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  getCachedProductBySlug,
  getCachedProductListing,
} from "@/app/_data/catalog";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { ProductGrid } from "@/components/storefront/product-grid";
import { ProductPurchasePanel } from "@/components/storefront/product-purchase-panel";
import { SpecTable } from "@/components/storefront/spec-table";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { consultationCtaHref, installationCtaHref } from "@/lib/site-config";
import { env } from "@/lib/env";
import { isNotFoundError } from "@/lib/errors";
import { getAvailableQuantity } from "@/src/modules/inventory/use-cases/get-available-quantity";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

// No `generateStaticParams` — every slug is looked up per-request (the
// cached `getCachedProductBySlug` call still avoids re-hitting the DB on
// a cache hit). `instant = false` tells Cache Components this route is
// allowed to block rather than requiring a fully static/instant
// navigation, matching `app/account/page.tsx`'s existing convention for
// any page that can't be known ahead of time.
export const instant = false;

async function loadProduct(slug: string) {
  try {
    return await getCachedProductBySlug(slug);
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
  const product = await loadProduct(slug);
  if (!product) return {};
  return {
    title: product.seoTitle ?? product.name,
    description:
      product.seoDescription ?? product.shortDescription ?? undefined,
    alternates: { canonical: `${env.APP_BASE_URL}/products/${product.slug}` },
    openGraph: {
      title: product.seoTitle ?? product.name,
      description:
        product.seoDescription ?? product.shortDescription ?? undefined,
      images: product.images[0] ? [{ url: product.images[0].url }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: product.seoTitle ?? product.name,
      description:
        product.seoDescription ?? product.shortDescription ?? undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  const product = await loadProduct(slug);
  if (!product) {
    notFound();
  }

  const activeVariants = product.variants.filter((v) => v.status === "ACTIVE");
  // Live availability is deliberately NOT cached (docs/PHASE_9_STOREFRONT_PLAN.md
  // §8) — fetched fresh, per request, directly here rather than baked
  // into the cached product read.
  const availabilityEntries = await Promise.all(
    activeVariants.map(async (variant) => {
      const quantity = await getAvailableQuantity(BigInt(variant.id));
      return [variant.id, quantity] as const;
    }),
  );
  const availableQuantityByVariantId = Object.fromEntries(availabilityEntries);

  const selectedVariantForSpecs =
    activeVariants.find((v) => v.isDefault) ??
    activeVariants[0] ??
    product.variants[0];

  const relatedProductsPage = await getCachedProductListing({
    limit: 4,
    featured: undefined,
    categoryId: BigInt(product.category.id),
  });
  const relatedProducts = relatedProductsPage.items.filter(
    (p) => p.slug !== product.slug,
  );

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription ?? undefined,
    image: product.images.map((i) => i.url),
    brand: product.brand
      ? { "@type": "Brand", name: product.brand.name }
      : undefined,
    offers: selectedVariantForSpecs
      ? {
          "@type": "Offer",
          priceCurrency: selectedVariantForSpecs.currency,
          price: (selectedVariantForSpecs.priceMinor / 100).toFixed(2),
          availability:
            (availableQuantityByVariantId[selectedVariantForSpecs.id] ?? 0) > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
        }
      : undefined,
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: c("catalog.detail.home"),
        item: `${env.APP_BASE_URL}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: product.category.name,
        item: `${env.APP_BASE_URL}/categories/${product.category.slug}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: product.name,
        item: `${env.APP_BASE_URL}/products/${product.slug}`,
      },
    ],
  };

  return (
    <div className="page-shell py-8 sm:py-10">
      {/* `JSON.stringify` alone doesn't escape `<`, so an admin-entered
       * product name/description containing a literal `</script>` could
       * otherwise break out of this tag — `replace` closes that hole
       * (docs/PHASE_9_STOREFRONT_PLAN.md §21/§17). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, "\\u003c"),
        }}
      />

      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>
              {c("catalog.detail.home")}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink
              render={<Link href={`/categories/${product.category.slug}`} />}
            >
              {product.category.name}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{product.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="grid gap-8 md:grid-cols-2">
        <ProductGallery images={product.images} productName={product.name} />

        <div className="flex flex-col gap-4">
          {product.brand ? (
            <Link
              href={`/brands/${product.brand.slug}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {product.brand.name}
            </Link>
          ) : null}
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          {product.shortDescription ? (
            <p className="text-muted-foreground">{product.shortDescription}</p>
          ) : null}

          <ProductPurchasePanel
            variants={product.variants}
            availableQuantityByVariantId={availableQuantityByVariantId}
          />

          <div className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <p className="font-medium">{c("catalog.detail.help")}</p>
            <div className="flex flex-wrap gap-3">
              <Link
                href={consultationCtaHref}
                className="text-primary-emphasis underline"
              >
                {c("catalog.detail.consultation")}
              </Link>
              <Link
                href={installationCtaHref}
                className="text-primary-emphasis underline"
              >
                {c("catalog.detail.installation")}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {product.description ? (
        <div className="mt-10 max-w-3xl">
          <h2 className="mb-2 text-sm font-semibold">
            {c("catalog.detail.description")}
          </h2>
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            {product.description}
          </p>
        </div>
      ) : null}

      {selectedVariantForSpecs ? (
        <div className="mt-10">
          <SpecTable
            variant={selectedVariantForSpecs}
            specifications={product.specifications}
          />
        </div>
      ) : null}

      {relatedProducts.length > 0 ? (
        <div className="mt-12">
          <h2 className="mb-4 text-lg font-semibold">
            {c("catalog.detail.related")}
          </h2>
          <ProductGrid products={relatedProducts} />
        </div>
      ) : null}
    </div>
  );
}

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { PriceDisplay } from "@/components/storefront/price-display";
import { ProductImage } from "@/components/storefront/product-image";
import { Badge } from "@/components/ui/badge";
import type { ProductSummary } from "@/src/modules/catalog/types";

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md"
    >
      <div className="relative aspect-[4/4.3] overflow-hidden bg-muted">
        {product.primaryImage ? (
          <ProductImage
            src={product.primaryImage.url}
            alt={product.primaryImage.altText ?? product.name}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-contain p-5 transition-transform duration-300 group-hover:scale-[1.035]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            No image yet
          </div>
        )}
        {product.isFeatured ? (
          <Badge className="absolute left-3 top-3 bg-brand-sun text-brand-sun-foreground hover:bg-brand-sun">
            Featured
          </Badge>
        ) : null}
        <span className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-background/88 text-foreground opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100">
          <ArrowUpRight className="size-4" />
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        {product.brand ? (
          <span className="text-[11px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
            {product.brand.name}
          </span>
        ) : null}
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 tracking-tight">
          {product.name}
        </h3>
        {product.defaultVariant ? (
          <div className="mt-auto border-t pt-3">
            <PriceDisplay
              priceMinor={product.defaultVariant.priceMinor}
              compareAtPriceMinor={product.defaultVariant.compareAtPriceMinor}
              currency={product.defaultVariant.currency}
            />
          </div>
        ) : null}
      </div>
    </Link>
  );
}

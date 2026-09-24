"use client";

import { useState } from "react";

import { ProductImage } from "@/components/storefront/product-image";
import { Button } from "@/components/ui/button";
import type { CatalogImage } from "@/src/modules/catalog/types";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";
import { interpolateCopy } from "@/src/modules/site-copy/copy";

/** Client only because thumbnail selection is genuinely interactive state
 * — the images themselves were already fetched server-side. */
export function ProductGallery({
  images,
  productName,
}: {
  images: CatalogImage[];
  productName: string;
}) {
  const copy = useSiteCopy();
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex];

  if (!active) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        {copy("catalog.gallery.noImage")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
        <ProductImage
          src={active.url}
          alt={active.altText ?? productName}
          fill
          sizes="(min-width: 1024px) 40vw, 100vw"
          priority={activeIndex === 0}
          className="object-contain p-5"
        />
      </div>
      {images.length > 1 ? (
        <div
          className="flex gap-2 overflow-x-auto"
          role="tablist"
          aria-label={copy("catalog.gallery.aria")}
        >
          {images.map((image, index) => (
            <Button
              key={image.id}
              type="button"
              variant="outline"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={interpolateCopy(copy("catalog.gallery.viewImage"), {
                index: index + 1,
                count: images.length,
              })}
              onClick={() => setActiveIndex(index)}
              className={`relative size-16 shrink-0 overflow-hidden p-0 ${
                index === activeIndex
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border"
              }`}
            >
              <ProductImage
                src={image.url}
                alt=""
                fill
                sizes="64px"
                className="object-contain p-1"
              />
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

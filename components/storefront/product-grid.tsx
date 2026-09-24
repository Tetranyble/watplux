"use client";

import { PackageSearch, type LucideIcon } from "lucide-react";

import { ProductCard } from "@/components/storefront/product-card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProductSummary } from "@/src/modules/catalog/types";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

export function ProductGrid({
  products,
  emptyTitle,
  emptyMessage,
  emptyAction,
  emptyIcon: EmptyIcon = PackageSearch,
}: {
  products: ProductSummary[];
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  emptyIcon?: LucideIcon;
}) {
  const copy = useSiteCopy();
  if (products.length === 0) {
    return (
      <EmptyState
        className="min-h-80"
        icon={EmptyIcon}
        title={emptyTitle ?? copy("catalog.grid.emptyTitle")}
        description={emptyMessage ?? copy("catalog.grid.emptyDescription")}
        action={emptyAction}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

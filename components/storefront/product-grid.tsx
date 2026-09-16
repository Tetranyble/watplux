import { PackageSearch, type LucideIcon } from "lucide-react";

import { ProductCard } from "@/components/storefront/product-card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProductSummary } from "@/src/modules/catalog/types";

export function ProductGrid({
  products,
  emptyTitle = "No products found",
  emptyMessage = "Products will appear here when they become available.",
  emptyAction,
  emptyIcon: EmptyIcon = PackageSearch,
}: {
  products: ProductSummary[];
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  emptyIcon?: LucideIcon;
}) {
  if (products.length === 0) {
    return (
      <EmptyState
        className="min-h-80"
        icon={EmptyIcon}
        title={emptyTitle}
        description={emptyMessage}
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

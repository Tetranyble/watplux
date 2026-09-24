"use client";

import Link from "next/link";
import { PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

export default function ProductNotFound() {
  const copy = useSiteCopy();
  return (
    <div className="page-shell flex flex-1">
      <EmptyState
        icon={PackageSearch}
        title={copy("catalog.notFound.productTitle")}
        description={copy("catalog.notFound.productDescription")}
        action={
          <Button nativeButton={false} render={<Link href="/products" />}>
            {copy("catalog.collection.allProducts")}
          </Button>
        }
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { Tags } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

export default function BrandNotFound() {
  const copy = useSiteCopy();
  return (
    <div className="page-shell flex flex-1">
      <EmptyState
        icon={Tags}
        title={copy("catalog.notFound.brandTitle")}
        description={copy("catalog.notFound.brandDescription")}
        action={
          <Button nativeButton={false} render={<Link href="/products" />}>
            {copy("catalog.collection.allProducts")}
          </Button>
        }
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { FolderSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

export default function CategoryNotFound() {
  const copy = useSiteCopy();
  return (
    <div className="page-shell flex flex-1">
      <EmptyState
        icon={FolderSearch}
        title={copy("catalog.notFound.categoryTitle")}
        description={copy("catalog.notFound.categoryDescription")}
        action={
          <Button nativeButton={false} render={<Link href="/products" />}>
            {copy("catalog.collection.allProducts")}
          </Button>
        }
      />
    </div>
  );
}

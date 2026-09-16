import Link from "next/link";
import { PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AdminProductNotFound() {
  return (
    <EmptyState
      icon={PackageSearch}
      title="Product not found"
      description="No product exists with that ID. It may have been removed."
      action={
        <Button
          nativeButton={false}
          render={<Link href="/admin/catalog/products" />}
        >
          Back to products
        </Button>
      }
    />
  );
}

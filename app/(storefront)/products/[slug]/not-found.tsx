import Link from "next/link";
import { PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ProductNotFound() {
  return (
    <div className="page-shell flex flex-1">
      <EmptyState
        icon={PackageSearch}
        title="Product not found"
        description="This product doesn’t exist or is no longer available."
        action={
          <Button nativeButton={false} render={<Link href="/products" />}>
            Browse all products
          </Button>
        }
      />
    </div>
  );
}

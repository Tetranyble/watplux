import Link from "next/link";
import { FolderSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function CategoryNotFound() {
  return (
    <div className="page-shell flex flex-1">
      <EmptyState
        icon={FolderSearch}
        title="Category not found"
        description="This category doesn’t exist or is no longer available."
        action={
          <Button nativeButton={false} render={<Link href="/products" />}>
            Browse all products
          </Button>
        }
      />
    </div>
  );
}

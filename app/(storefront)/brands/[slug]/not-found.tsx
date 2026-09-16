import Link from "next/link";
import { Tags } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function BrandNotFound() {
  return (
    <div className="page-shell flex flex-1">
      <EmptyState
        icon={Tags}
        title="Brand not found"
        description="This brand doesn’t exist or is no longer available."
        action={
          <Button nativeButton={false} render={<Link href="/products" />}>
            Browse all products
          </Button>
        }
      />
    </div>
  );
}

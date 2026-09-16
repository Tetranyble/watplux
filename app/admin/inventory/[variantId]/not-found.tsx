import Link from "next/link";
import { PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AdminInventoryVariantNotFound() {
  return (
    <EmptyState
      icon={PackageSearch}
      title="Invalid variant"
      description="That variant ID isn’t valid or no longer exists."
      action={
        <Button nativeButton={false} render={<Link href="/admin/inventory" />}>
          Back to inventory
        </Button>
      }
    />
  );
}

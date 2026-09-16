import Link from "next/link";
import { UserSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AdminCustomerNotFound() {
  return (
    <EmptyState
      icon={UserSearch}
      title="Customer not found"
      description="No account exists with that ID. It may have been removed."
      action={
        <Button nativeButton={false} render={<Link href="/admin/customers" />}>
          Back to customers
        </Button>
      }
    />
  );
}

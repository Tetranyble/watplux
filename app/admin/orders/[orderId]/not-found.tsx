import Link from "next/link";
import { ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AdminOrderNotFound() {
  return (
    <EmptyState
      icon={ReceiptText}
      title="Order not found"
      description="No order exists with that ID. It may have been removed."
      action={
        <Button nativeButton={false} render={<Link href="/admin/orders" />}>
          Back to orders
        </Button>
      }
    />
  );
}

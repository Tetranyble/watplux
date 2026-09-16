import Link from "next/link";
import { ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function OrderNotFound() {
  return (
    <div className="page-shell flex flex-1">
      <EmptyState
        icon={ReceiptText}
        title="Order not found"
        description="This order doesn’t exist or isn’t associated with your account."
        action={
          <Button nativeButton={false} render={<Link href="/account/orders" />}>
            View your orders
          </Button>
        }
      />
    </div>
  );
}

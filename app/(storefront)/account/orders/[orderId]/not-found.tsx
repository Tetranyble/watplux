"use client";

import Link from "next/link";
import { ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

export default function OrderNotFound() {
  const copy = useSiteCopy();
  return (
    <div className="page-shell flex flex-1">
      <EmptyState
        icon={ReceiptText}
        title={copy("account.order.notFoundTitle")}
        description={copy("account.order.notFoundDescription")}
        action={
          <Button nativeButton={false} render={<Link href="/account/orders" />}>
            {copy("account.order.viewAll")}
          </Button>
        }
      />
    </div>
  );
}

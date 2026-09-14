import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function OrderNotFound() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Order not found</h1>
      <p className="text-muted-foreground">
        This order doesn&apos;t exist, or isn&apos;t associated with your
        account.
      </p>
      <Button nativeButton={false} render={<Link href="/account/orders" />}>
        View your orders
      </Button>
    </div>
  );
}

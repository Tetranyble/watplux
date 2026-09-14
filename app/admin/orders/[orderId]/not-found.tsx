import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AdminOrderNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Order not found</h1>
      <p className="text-muted-foreground">No order exists with that ID.</p>
      <Button nativeButton={false} render={<Link href="/admin/orders" />}>
        Back to orders
      </Button>
    </div>
  );
}

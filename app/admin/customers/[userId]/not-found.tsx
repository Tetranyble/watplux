import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AdminCustomerNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Customer not found</h1>
      <p className="text-muted-foreground">No user exists with that ID.</p>
      <Button nativeButton={false} render={<Link href="/admin" />}>
        Back to dashboard
      </Button>
    </div>
  );
}

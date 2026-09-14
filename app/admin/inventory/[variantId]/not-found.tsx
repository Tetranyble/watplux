import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AdminInventoryVariantNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Invalid variant</h1>
      <p className="text-muted-foreground">That variant ID isn&apos;t valid.</p>
      <Button nativeButton={false} render={<Link href="/admin/inventory" />}>
        Back to inventory
      </Button>
    </div>
  );
}

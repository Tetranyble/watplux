import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AdminProductNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Product not found</h1>
      <p className="text-muted-foreground">No product exists with that ID.</p>
      <Button
        nativeButton={false}
        render={<Link href="/admin/catalog/products" />}
      >
        Back to products
      </Button>
    </div>
  );
}

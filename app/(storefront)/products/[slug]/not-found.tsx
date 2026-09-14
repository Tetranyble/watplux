import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function ProductNotFound() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Product not found</h1>
      <p className="text-muted-foreground">
        This product doesn&apos;t exist, or is no longer available.
      </p>
      <Button nativeButton={false} render={<Link href="/products" />}>
        Browse all products
      </Button>
    </div>
  );
}

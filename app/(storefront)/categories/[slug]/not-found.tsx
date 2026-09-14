import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function CategoryNotFound() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Category not found</h1>
      <p className="text-muted-foreground">This category doesn&apos;t exist.</p>
      <Button nativeButton={false} render={<Link href="/products" />}>
        Browse all products
      </Button>
    </div>
  );
}

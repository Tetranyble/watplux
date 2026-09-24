import Link from "next/link";
import type { Metadata } from "next";
import { ShoppingCart } from "lucide-react";

import { CartList } from "@/components/storefront/cart-list";
import { CartSummary } from "@/components/storefront/cart-summary";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { resolveCartActor } from "@/lib/cart-actor";
import { getActiveCart } from "@/src/modules/cart/use-cases/get-active-cart";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return {
    title: copyValue(copy, "commerce.cart.metaTitle"),
    robots: { index: false, follow: false },
  };
}

// Session/guest-cookie-dependent — never cached, never statically
// prerendered (docs/PHASE_9_STOREFRONT_PLAN.md §8).
export const instant = false;

export default async function CartPage() {
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  const actor = await resolveCartActor();
  const cart = actor.type === "none" ? null : await getActiveCart(actor);

  if (!cart || cart.items.length === 0) {
    return (
      <div className="page-shell flex flex-1">
        <EmptyState
          icon={ShoppingCart}
          title={c("commerce.cart.emptyTitle")}
          description={c("commerce.cart.emptyPageDescription")}
          action={
            <Button nativeButton={false} render={<Link href="/products" />}>
              {c("commerce.cart.browse")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page-shell py-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-semibold">
        {c("commerce.cart.title")}
      </h1>
      <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
        <CartList items={cart.items} />
        <CartSummary
          itemCount={cart.itemCount}
          subtotalDisplayMinor={cart.subtotalDisplayMinor}
        />
      </div>
    </div>
  );
}

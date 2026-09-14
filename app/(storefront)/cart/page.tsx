import Link from "next/link";
import type { Metadata } from "next";

import { CartList } from "@/components/storefront/cart-list";
import { CartSummary } from "@/components/storefront/cart-summary";
import { Button } from "@/components/ui/button";
import { resolveCartActor } from "@/lib/cart-actor";
import { getActiveCart } from "@/src/modules/cart/use-cases/get-active-cart";

export const metadata: Metadata = {
  title: "Your cart",
};

// Session/guest-cookie-dependent — never cached, never statically
// prerendered (docs/PHASE_9_STOREFRONT_PLAN.md §8).
export const instant = false;

export default async function CartPage() {
  const actor = await resolveCartActor();
  const cart = actor.type === "none" ? null : await getActiveCart(actor);

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Your cart is empty</h1>
        <p className="text-muted-foreground">
          Browse our catalog to find solar equipment for your home or business.
        </p>
        <Button nativeButton={false} render={<Link href="/products" />}>
          Browse products
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Your cart</h1>
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

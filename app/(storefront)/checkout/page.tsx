import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { CartSummary } from "@/components/storefront/cart-summary";
import { CheckoutAddressForm } from "@/components/storefront/checkout-address-form";
import { resolveCartActor } from "@/lib/cart-actor";
import { getSessionUser } from "@/lib/session";
import { getActiveCart } from "@/src/modules/cart/use-cases/get-active-cart";

export const metadata: Metadata = {
  title: "Checkout",
};

// Session/guest-cookie-dependent — never cached (docs/PHASE_9_STOREFRONT_PLAN.md §8).
export const instant = false;

export default async function CheckoutPage() {
  const [actor, sessionUser] = await Promise.all([
    resolveCartActor(),
    getSessionUser(),
  ]);
  const cart = actor.type === "none" ? null : await getActiveCart(actor);

  if (!cart || cart.items.length === 0) {
    // Matches the existing `POST /api/checkout` route's own `NotFoundError`
    // when there's no active cart — the storefront redirects instead of
    // rendering a form that would fail on submit either way.
    redirect("/cart");
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Secure checkout
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Complete your order
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Confirm where your items should go, then continue to Paystack to pay.
        </p>
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <CheckoutAddressForm isAuthenticated={sessionUser !== null} />
        <div className="lg:sticky lg:top-24">
          <CartSummary
            itemCount={cart.itemCount}
            subtotalDisplayMinor={cart.subtotalDisplayMinor}
            showCheckoutButton={false}
          />
        </div>
      </div>
    </div>
  );
}

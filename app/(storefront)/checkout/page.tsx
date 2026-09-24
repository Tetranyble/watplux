import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { CartSummary } from "@/components/storefront/cart-summary";
import { CheckoutAddressForm } from "@/components/storefront/checkout-address-form";
import { resolveCartActor } from "@/lib/cart-actor";
import { getSessionUser } from "@/lib/session";
import { getActiveCart } from "@/src/modules/cart/use-cases/get-active-cart";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return { title: copyValue(copy, "commerce.checkout.metaTitle") };
}

// Session/guest-cookie-dependent — never cached (docs/PHASE_9_STOREFRONT_PLAN.md §8).
export const instant = false;

export default async function CheckoutPage() {
  const [actor, sessionUser, copy] = await Promise.all([
    resolveCartActor(),
    getSessionUser(),
    getSiteCopy(),
  ]);
  const c = (key: string) => copyValue(copy, key);
  const cart = actor.type === "none" ? null : await getActiveCart(actor);

  if (!cart || cart.items.length === 0) {
    // Matches the existing `POST /api/checkout` route's own `NotFoundError`
    // when there's no active cart — the storefront redirects instead of
    // rendering a form that would fail on submit either way.
    redirect("/cart");
  }

  return (
    <div className="page-shell py-10 sm:py-14">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-emphasis">
          {c("commerce.checkout.eyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {c("commerce.checkout.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {c("commerce.checkout.description")}
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

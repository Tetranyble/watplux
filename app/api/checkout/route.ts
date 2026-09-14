import { NextResponse } from "next/server";

import { resolveCartActor } from "@/lib/cart-actor";
import { NotFoundError } from "@/lib/errors";
import { errorResponse } from "@/lib/http-error-response";
import { getSessionUser } from "@/lib/session";
import { enforcePublicRateLimit } from "@/lib/rate-limit-http";
import { completeCheckoutSchema } from "@/src/modules/checkout/schema";
import { completeCheckout } from "@/src/modules/checkout/use-cases/complete-checkout";

/**
 * The only mutating Checkout route (docs/PHASE_7_CART_CHECKOUT_PLAN.md
 * §27) — never trusts a client-supplied price/subtotal/total/discount/
 * tax/product name/SKU/ownership field; only address + optional guest
 * contact details are accepted. No webhook route, no payment-verification
 * route, no refund route exist in this file — those are Payment's own,
 * separate routes (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §12/§16/§22).
 *
 * `getSessionUser()` is called here (not inside the use-case, which must
 * never import `next/headers`) purely to resolve the authenticated
 * actor's email for Paystack's Initialize call — `resolveCartActor()`'s
 * `CartOwner` shape deliberately carries only `userId`, not email (plan
 * §8's additive checkout-integration step).
 */
export async function POST(request: Request) {
  try {
    const limited = await enforcePublicRateLimit(request, {
      namespace: "checkout-submit",
      windowSeconds: 300,
      max: 8,
    });
    if (limited) return limited;
    const actor = await resolveCartActor();
    if (actor.type === "none") {
      throw new NotFoundError("Cart not found.");
    }
    const sessionUser = await getSessionUser();
    const input = completeCheckoutSchema.parse(await request.json());
    const { order, payment, guestOrderAccessToken } = await completeCheckout(
      actor,
      input,
      sessionUser?.email ?? null,
    );
    return NextResponse.json(
      { order, payment, guestOrderAccessToken },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

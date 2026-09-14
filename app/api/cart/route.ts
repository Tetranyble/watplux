import { NextResponse } from "next/server";

import { resolveCartActor } from "@/lib/cart-actor";
import { errorResponse } from "@/lib/http-error-response";
import { clearCart } from "@/src/modules/cart/use-cases/clear-cart";
import { getActiveCart } from "@/src/modules/cart/use-cases/get-active-cart";

/** Never lazily creates a cart — a bare read of "do I have a cart" must
 * not have a side effect (docs/PHASE_7_CART_CHECKOUT_PLAN.md §5/§23).
 * `cart: null` is a normal response, not an error. */
export async function GET() {
  try {
    const actor = await resolveCartActor();
    const cart = actor.type === "none" ? null : await getActiveCart(actor);
    return NextResponse.json({ cart });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Clearing a nonexistent cart is a no-op, not an error (plan §24). */
export async function DELETE() {
  try {
    const actor = await resolveCartActor();
    const cart = actor.type === "none" ? null : await clearCart(actor);
    return NextResponse.json({ cart });
  } catch (error) {
    return errorResponse(error);
  }
}

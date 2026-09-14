import { NextResponse } from "next/server";

import { resolveCartActor } from "@/lib/cart-actor";
import { errorResponse } from "@/lib/http-error-response";
import { getCartItemCount } from "@/src/modules/cart/use-cases/get-cart-item-count";

/** Lightweight count-only read for a header/badge UI
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §23) — `0` for "no cart yet," never
 * an error. */
export async function GET() {
  try {
    const actor = await resolveCartActor();
    const count = actor.type === "none" ? 0 : await getCartItemCount(actor);
    return NextResponse.json({ count });
  } catch (error) {
    return errorResponse(error);
  }
}

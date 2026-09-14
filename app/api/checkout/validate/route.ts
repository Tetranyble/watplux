import { NextResponse } from "next/server";

import { resolveCartActor } from "@/lib/cart-actor";
import { NotFoundError } from "@/lib/errors";
import { errorResponse } from "@/lib/http-error-response";
import { validateCheckout } from "@/src/modules/checkout/use-cases/validate-checkout";

/** Read-only preview — no mutation, no transaction beyond simple reads
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §25). */
export async function GET() {
  try {
    const actor = await resolveCartActor();
    if (actor.type === "none") {
      throw new NotFoundError("Cart not found.");
    }
    const report = await validateCheckout(actor);
    return NextResponse.json({ report });
  } catch (error) {
    return errorResponse(error);
  }
}

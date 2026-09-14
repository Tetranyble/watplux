import { NextResponse } from "next/server";

import { resolveOrCreateCartOwner } from "@/lib/cart-actor";
import { errorResponse } from "@/lib/http-error-response";
import { addCartItemSchema } from "@/src/modules/cart/schema";
import { addCartItem } from "@/src/modules/cart/use-cases/add-cart-item";

/** The only cart route allowed to lazily create a cart
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §5/§24) — `resolveOrCreateCartOwner`
 * issues a fresh guest-cart cookie as a side effect if the caller has
 * neither a session nor an existing guest cookie. Never trusts a
 * client-supplied price/subtotal/name/SKU — only `variantId` +
 * `quantity` are accepted at all. */
export async function POST(request: Request) {
  try {
    const owner = await resolveOrCreateCartOwner();
    const input = addCartItemSchema.parse(await request.json());
    const cart = await addCartItem(owner, input);
    return NextResponse.json({ cart }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

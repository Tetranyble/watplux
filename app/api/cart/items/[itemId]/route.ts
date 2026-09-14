import { NextResponse } from "next/server";

import { resolveCartActor } from "@/lib/cart-actor";
import { errorResponse } from "@/lib/http-error-response";
import { NotFoundError } from "@/lib/errors";
import {
  idParamSchema,
  updateCartItemQuantitySchema,
} from "@/src/modules/cart/schema";
import { removeCartItem } from "@/src/modules/cart/use-cases/remove-cart-item";
import { updateCartItemQuantity } from "@/src/modules/cart/use-cases/update-cart-item-quantity";

/** Ownership is enforced inside the use-case itself (compound
 * `cartId`+`cartItemId` check, docs/PHASE_7_CART_CHECKOUT_PLAN.md §24/§27)
 * — a caller with no cart at all is rejected the same as a forged item id. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const actor = await resolveCartActor();
    if (actor.type === "none") {
      throw new NotFoundError("Cart not found.");
    }
    const { itemId } = await params;
    const input = updateCartItemQuantitySchema.parse(await request.json());
    const cart = await updateCartItemQuantity(
      actor,
      idParamSchema.parse(itemId),
      input,
    );
    return NextResponse.json({ cart });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const actor = await resolveCartActor();
    if (actor.type === "none") {
      throw new NotFoundError("Cart not found.");
    }
    const { itemId } = await params;
    const cart = await removeCartItem(actor, idParamSchema.parse(itemId));
    return NextResponse.json({ cart });
  } catch (error) {
    return errorResponse(error);
  }
}

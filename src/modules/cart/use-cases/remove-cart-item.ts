import { ForbiddenError, NotFoundError } from "@/lib/errors";
import * as cartRepo from "@/src/modules/cart/repo";
import { toCartDetail } from "@/src/modules/cart/types";
import type { CartDetail, CartOwner } from "@/src/modules/cart/types";

/** Same ownership-verification shape as `updateCartItemQuantity` (plan
 * §24/§27). */
export async function removeCartItem(
  owner: CartOwner,
  cartItemId: bigint,
): Promise<CartDetail> {
  // See the identical ordering rationale in `updateCartItemQuantity`: the
  // item's existence is checked before the caller's own cart, so a
  // caller with no cart at all still gets 403 (not theirs) rather than a
  // masking 404 for an item that genuinely exists.
  const item = await cartRepo.findCartItemById(cartItemId);
  if (!item) {
    throw new NotFoundError("Cart item not found.");
  }

  const myCartId = await cartRepo.findActiveCartId(owner);
  if (!myCartId || item.cartId !== myCartId) {
    throw new ForbiddenError("You cannot modify this cart item.");
  }

  await cartRepo.removeCartItem(myCartId, cartItemId);

  const result = await cartRepo.findActiveCartWithItems(owner);
  if (!result) {
    throw new NotFoundError("Cart not found.");
  }
  return toCartDetail(result.cart, result.items);
}

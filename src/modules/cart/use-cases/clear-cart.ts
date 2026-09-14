import * as cartRepo from "@/src/modules/cart/repo";
import { toCartDetail } from "@/src/modules/cart/types";
import type { CartDetail, CartOwner } from "@/src/modules/cart/types";

/** `null` if there was no active cart to clear — symmetric with
 * `getActiveCart`'s "absence is a normal state" convention (plan §24 —
 * "clearing an empty cart is a no-op"). */
export async function clearCart(owner: CartOwner): Promise<CartDetail | null> {
  const myCartId = await cartRepo.findActiveCartId(owner);
  if (!myCartId) {
    return null;
  }

  await cartRepo.clearCart(myCartId);

  const result = await cartRepo.findActiveCartWithItems(owner);
  if (!result) {
    // Unreachable: we just confirmed the cart exists above.
    return null;
  }
  return toCartDetail(result.cart, result.items);
}

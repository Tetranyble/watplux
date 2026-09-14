import * as cartRepo from "@/src/modules/cart/repo";
import { toCartDetail } from "@/src/modules/cart/types";
import type { CartDetail, CartOwner } from "@/src/modules/cart/types";

/** Plan §23 — `null` is a normal state ("no cart yet"), never an error,
 * matching `getAvailableQuantity`'s established precedent. */
export async function getActiveCart(
  owner: CartOwner,
): Promise<CartDetail | null> {
  const result = await cartRepo.findActiveCartWithItems(owner);
  if (!result) return null;
  return toCartDetail(result.cart, result.items);
}

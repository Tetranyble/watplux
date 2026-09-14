import * as cartRepo from "@/src/modules/cart/repo";
import type { CartOwner } from "@/src/modules/cart/types";

/** Plan §23 — lightweight count-only read for a header/badge UI. */
export async function getCartItemCount(owner: CartOwner): Promise<number> {
  return cartRepo.countActiveCartItems(owner);
}

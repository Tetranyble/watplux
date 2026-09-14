import { Prisma } from "@prisma/client";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import * as cartRepo from "@/src/modules/cart/repo";
import { toCartDetail } from "@/src/modules/cart/types";
import type { UpdateCartItemQuantityInput } from "@/src/modules/cart/schema";
import type { CartDetail, CartOwner } from "@/src/modules/cart/types";

/**
 * Refreshes `priceSnapshotMinor` to the current catalog price at the same
 * moment (plan §7 — "since the mutation already touches the row, keeping
 * the display price current is free"). Ownership is verified via a
 * plain, pre-transaction read (mirrors `order/repo.ts`'s
 * `resolveOrderLine` pre-transaction-resolution pattern) so the
 * mutation's own `SELECT ... FOR UPDATE` remains genuinely its
 * transaction's first statement — `NotFoundError` (404) for a
 * nonexistent cart/item, `ForbiddenError` (403) for an item that exists
 * but belongs to someone else's cart, matching the established IDOR
 * convention (`get-user-profile.ts`/`get-order-by-id.ts`).
 */
export async function updateCartItemQuantity(
  owner: CartOwner,
  cartItemId: bigint,
  input: UpdateCartItemQuantityInput,
): Promise<CartDetail> {
  // The item's own existence is checked BEFORE the caller's cart
  // ownership — otherwise a caller with no cart at all would see a
  // generic "cart not found" for every id, masking the intended
  // 404-vs-403 IDOR distinction (an item that exists but isn't the
  // caller's must be 403, never 404).
  const item = await cartRepo.findCartItemById(cartItemId);
  if (!item) {
    throw new NotFoundError("Cart item not found.");
  }

  const myCartId = await cartRepo.findActiveCartId(owner);
  if (!myCartId || item.cartId !== myCartId) {
    throw new ForbiddenError("You cannot modify this cart item.");
  }

  const variant = await cartRepo.resolveVariantForCart(item.productVariantId);
  if (!variant) {
    throw new NotFoundError("Cart item not found.");
  }

  await cartRepo.updateCartItemQuantity(myCartId, cartItemId, {
    quantity: new Prisma.Decimal(input.quantity),
    priceSnapshotMinor: variant.priceMinor,
  });

  const result = await cartRepo.findActiveCartWithItems(owner);
  if (!result) {
    throw new NotFoundError("Cart not found.");
  }
  return toCartDetail(result.cart, result.items);
}

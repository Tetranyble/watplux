import { Prisma } from "@prisma/client";

import { NotFoundError, ValidationError } from "@/lib/errors";
import * as cartRepo from "@/src/modules/cart/repo";
import { toCartDetail } from "@/src/modules/cart/types";
import type { AddCartItemInput } from "@/src/modules/cart/schema";
import type { CartDetail, CartOwner } from "@/src/modules/cart/types";

/**
 * Lazily creates the caller's cart on first use (plan §5/§24) — the only
 * cart mutation allowed to do so. The client submits only `variantId` +
 * `quantity`; price/identity/availability are always server-resolved
 * (plan §7) — inventory availability is intentionally NOT checked here
 * (non-authoritative, and this phase builds no UI to surface it; the
 * hard, authoritative gate is checkout, plan §10/§20).
 */
export async function addCartItem(
  owner: CartOwner,
  input: AddCartItemInput,
): Promise<CartDetail> {
  const variant = await cartRepo.resolveVariantForCart(input.variantId);
  if (!variant) {
    throw new NotFoundError(`Product variant ${input.variantId} not found.`);
  }
  if (variant.status !== "ACTIVE") {
    throw new ValidationError(
      `Product variant ${input.variantId} is not available for purchase.`,
    );
  }

  const cartId = await cartRepo.getOrCreateActiveCartId(owner);
  await cartRepo.addOrIncrementCartItem(cartId, {
    productVariantId: input.variantId,
    quantity: new Prisma.Decimal(input.quantity),
    priceSnapshotMinor: variant.priceMinor,
  });

  const result = await cartRepo.findActiveCartWithItems(owner);
  if (!result) {
    // Unreachable: we just created/confirmed the cart above.
    throw new NotFoundError("Cart not found.");
  }
  return toCartDetail(result.cart, result.items);
}

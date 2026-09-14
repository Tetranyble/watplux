import { Prisma } from "@prisma/client";

import { NotFoundError } from "@/lib/errors";
import * as cartRepo from "@/src/modules/cart/repo";
import type { CartOwner } from "@/src/modules/cart/types";
import { classifyCheckoutLine } from "@/src/modules/checkout/domain/checkout-line-classification";
import { getAvailableQuantity } from "@/src/modules/inventory/use-cases/get-available-quantity";
import { roundMinorUnits } from "@/src/modules/order/domain/order-totals";
import type {
  CheckoutLineReport,
  CheckoutValidationReport,
} from "@/src/modules/checkout/types";

/**
 * Read-only preview (plan §25/§26) — no mutation, no transaction beyond
 * simple reads. `completeCheckout`'s own composed transaction
 * re-validates everything authoritatively regardless of what this
 * reports (plan §16); this is a preview for a confirmation UI, not a
 * replacement for that authoritative re-check.
 */
export async function validateCheckout(
  owner: CartOwner,
): Promise<CheckoutValidationReport> {
  const result = await cartRepo.findActiveCartWithItems(owner);
  if (!result) {
    throw new NotFoundError("Cart not found.");
  }
  if (result.items.length === 0) {
    return {
      cartId: result.cart.id.toString(),
      isValid: false,
      lines: [],
      currentSubtotalMinor: 0,
    };
  }

  const lines: CheckoutLineReport[] = [];
  for (const item of result.items) {
    const isVariantActive = item.productVariant.status === "ACTIVE";
    // Non-authoritative — informational only (plan §8/§20); the real
    // gate is the guarded `UPDATE` inside `reserveInventoryForNewOrderItem`,
    // evaluated only at `completeCheckout` time.
    const availableQuantity = await getAvailableQuantity(item.productVariantId);
    const hasSufficientStock = availableQuantity >= item.quantity.toNumber();

    const classification = classifyCheckoutLine({
      sku: item.productVariant.sku,
      isVariantActive,
      hasSufficientStock,
    });

    lines.push({
      cartItemId: item.id.toString(),
      productVariantId: item.productVariantId.toString(),
      productName: item.productVariant.product.name,
      sku: item.productVariant.sku,
      quantity: item.quantity.toNumber(),
      isVariantActive,
      currentUnitPriceMinor: item.productVariant.priceMinor,
      hasSufficientStock,
      isValid: classification.isValid,
      issue: classification.issue,
    });
  }

  const currentSubtotalMinor = lines
    .filter((line) => line.isValid)
    .reduce(
      (sum, line) =>
        sum +
        roundMinorUnits(
          new Prisma.Decimal(line.currentUnitPriceMinor).times(line.quantity),
        ),
      0,
    );

  return {
    cartId: result.cart.id.toString(),
    isValid: lines.every((line) => line.isValid),
    lines,
    currentSubtotalMinor,
  };
}

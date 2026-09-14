/**
 * Safe, client-returnable projection for `validateCheckout`'s read-only
 * preview report (docs/PHASE_7_CART_CHECKOUT_PLAN.md §25/§26) — no
 * mutation, no transaction beyond simple reads. This is a preview only;
 * `completeCheckout`'s own composed transaction re-validates everything
 * authoritatively regardless (plan §16), so nothing here is ever trusted
 * as the final word.
 */

export interface CheckoutLineReport {
  cartItemId: string;
  productVariantId: string;
  productName: string;
  sku: string;
  quantity: number;
  isVariantActive: boolean;
  /** Current catalog price, as of this read — display-only, re-resolved
   * authoritatively again inside `completeCheckout`'s own transaction. */
  currentUnitPriceMinor: number;
  /** Non-authoritative — informational only (plan §8/§20); the real gate
   * is the guarded `UPDATE` inside `reserveInventoryForNewOrderItem`,
   * evaluated only at `completeCheckout` time. */
  hasSufficientStock: boolean;
  isValid: boolean;
  issue: string | null;
}

export interface CheckoutValidationReport {
  cartId: string;
  isValid: boolean;
  lines: CheckoutLineReport[];
  /** Sum of each valid line's `currentUnitPriceMinor * quantity`,
   * rounded — display-only preview total, not the authoritative order
   * total (which also folds in delivery fee/tax/discount at checkout
   * time, plan §9). */
  currentSubtotalMinor: number;
}

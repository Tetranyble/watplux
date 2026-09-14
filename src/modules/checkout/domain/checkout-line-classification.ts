/**
 * Pure checkout conflict-detection classification — zero I/O
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §20/§21/§28, unit-tested
 * exhaustively per the plan's own testing-matrix requirement: "given a
 * set of resolved line validations, produce the correct error/report
 * shape"). Lives in `checkout/domain/` — only `validate-checkout.ts` (a
 * use-case) imports it, and use-cases have no restriction on importing
 * `domain` modules.
 *
 * This is a PREVIEW classification only (`validateCheckout`); it never
 * decides whether `completeCheckout` succeeds — that transaction
 * re-validates authoritatively regardless (plan §16), reusing
 * `orderRepo.resolveOrderLine`'s own throwing behavior instead of this
 * function.
 */

export interface CheckoutLineClassificationInput {
  sku: string;
  isVariantActive: boolean;
  hasSufficientStock: boolean;
}

export interface CheckoutLineClassificationResult {
  isValid: boolean;
  issue: string | null;
}

export function classifyCheckoutLine(
  input: CheckoutLineClassificationInput,
): CheckoutLineClassificationResult {
  if (!input.isVariantActive) {
    return {
      isValid: false,
      issue: `${input.sku} is no longer available for purchase.`,
    };
  }
  if (!input.hasSufficientStock) {
    return {
      isValid: false,
      issue: `Insufficient stock for ${input.sku}.`,
    };
  }
  return { isValid: true, issue: null };
}

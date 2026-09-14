import { describe, expect, it } from "vitest";

import { classifyCheckoutLine } from "@/src/modules/checkout/domain/checkout-line-classification";

/** Pure checkout conflict-detection classification
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §20/§21/§28) — given a set of
 * resolved line validations, produce the correct error/report shape.
 * Zero I/O. */
describe("classifyCheckoutLine", () => {
  it("a valid line (active variant, sufficient stock) has no issue", () => {
    const result = classifyCheckoutLine({
      sku: "SKU-1",
      isVariantActive: true,
      hasSufficientStock: true,
    });
    expect(result).toEqual({ isValid: true, issue: null });
  });

  it("an inactive/archived variant is invalid, named by SKU", () => {
    const result = classifyCheckoutLine({
      sku: "SKU-2",
      isVariantActive: false,
      hasSufficientStock: true,
    });
    expect(result.isValid).toBe(false);
    expect(result.issue).toContain("SKU-2");
    expect(result.issue).toContain("no longer available");
  });

  it("insufficient stock is invalid, named by SKU", () => {
    const result = classifyCheckoutLine({
      sku: "SKU-3",
      isVariantActive: true,
      hasSufficientStock: false,
    });
    expect(result.isValid).toBe(false);
    expect(result.issue).toContain("SKU-3");
    expect(result.issue).toContain("Insufficient stock");
  });

  it("an inactive variant takes precedence over a stock issue in the reported message", () => {
    const result = classifyCheckoutLine({
      sku: "SKU-4",
      isVariantActive: false,
      hasSufficientStock: false,
    });
    expect(result.issue).toContain("no longer available");
    expect(result.issue).not.toContain("Insufficient stock");
  });
});

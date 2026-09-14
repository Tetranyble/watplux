import { describe, expect, it } from "vitest";

import {
  hasValidQuantityPrecision,
  isFiniteQuantity,
  isPositiveQuantity,
} from "@/src/modules/cart/quantity";

/** Mirrors `tests/unit/order-quantity.test.ts`/`tests/unit/inventory-quantity.test.ts`'s
 * exact shape — Cart's own small, deliberate duplication of the same
 * `DECIMAL(12,3)` predicates. */
describe("cart quantity predicates", () => {
  describe("isFiniteQuantity", () => {
    it("accepts finite numbers", () => {
      expect(isFiniteQuantity(1)).toBe(true);
      expect(isFiniteQuantity(0.5)).toBe(true);
    });

    it("rejects NaN/Infinity", () => {
      expect(isFiniteQuantity(NaN)).toBe(false);
      expect(isFiniteQuantity(Infinity)).toBe(false);
      expect(isFiniteQuantity(-Infinity)).toBe(false);
    });
  });

  describe("isPositiveQuantity", () => {
    it("accepts values strictly greater than zero", () => {
      expect(isPositiveQuantity(0.001)).toBe(true);
      expect(isPositiveQuantity(1000)).toBe(true);
    });

    it("rejects zero and negative values", () => {
      expect(isPositiveQuantity(0)).toBe(false);
      expect(isPositiveQuantity(-1)).toBe(false);
    });
  });

  describe("hasValidQuantityPrecision", () => {
    it("accepts up to 3 decimal places", () => {
      expect(hasValidQuantityPrecision(1)).toBe(true);
      expect(hasValidQuantityPrecision(2.5)).toBe(true);
      expect(hasValidQuantityPrecision(2.505)).toBe(true);
    });

    it("rejects more than 3 decimal places", () => {
      expect(hasValidQuantityPrecision(2.5001)).toBe(false);
      expect(hasValidQuantityPrecision(0.00001)).toBe(false);
    });
  });
});

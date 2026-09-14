import { describe, expect, it } from "vitest";

import {
  hasValidQuantityPrecision,
  isFiniteQuantity,
  isPositiveQuantity,
} from "@/src/modules/order/quantity";

describe("hasValidQuantityPrecision", () => {
  it("accepts a whole number", () => {
    expect(hasValidQuantityPrecision(50)).toBe(true);
  });

  it("accepts up to 3 decimal places", () => {
    expect(hasValidQuantityPrecision(2.5)).toBe(true);
    expect(hasValidQuantityPrecision(2.55)).toBe(true);
    expect(hasValidQuantityPrecision(2.555)).toBe(true);
  });

  it("rejects more than 3 decimal places", () => {
    expect(hasValidQuantityPrecision(2.5001)).toBe(false);
  });
});

describe("isPositiveQuantity", () => {
  it("accepts a positive number", () => {
    expect(isPositiveQuantity(1)).toBe(true);
  });

  it("rejects zero", () => {
    expect(isPositiveQuantity(0)).toBe(false);
  });

  it("rejects a negative number", () => {
    expect(isPositiveQuantity(-1)).toBe(false);
  });
});

describe("isFiniteQuantity", () => {
  it("accepts a normal number", () => {
    expect(isFiniteQuantity(5)).toBe(true);
  });

  it("rejects NaN and Infinity", () => {
    expect(isFiniteQuantity(NaN)).toBe(false);
    expect(isFiniteQuantity(Infinity)).toBe(false);
    expect(isFiniteQuantity(-Infinity)).toBe(false);
  });
});

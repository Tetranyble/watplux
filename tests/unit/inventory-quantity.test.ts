import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  computeAdjustmentDelta,
  hasValidQuantityPrecision,
  isFiniteQuantity,
  isPositiveQuantity,
} from "@/src/modules/inventory/quantity";

describe("hasValidQuantityPrecision", () => {
  it("accepts a whole number", () => {
    expect(hasValidQuantityPrecision(50)).toBe(true);
  });

  it("accepts up to 3 decimal places", () => {
    expect(hasValidQuantityPrecision(2.5)).toBe(true);
    expect(hasValidQuantityPrecision(2.55)).toBe(true);
    expect(hasValidQuantityPrecision(2.555)).toBe(true);
  });

  it("accepts exactly 0.001", () => {
    expect(hasValidQuantityPrecision(0.001)).toBe(true);
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

  it("rejects NaN", () => {
    expect(isFiniteQuantity(NaN)).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(isFiniteQuantity(Infinity)).toBe(false);
    expect(isFiniteQuantity(-Infinity)).toBe(false);
  });
});

describe("computeAdjustmentDelta", () => {
  it("computes a positive delta when the target exceeds the current value", () => {
    const delta = computeAdjustmentDelta(
      new Prisma.Decimal("10.000"),
      new Prisma.Decimal("15.500"),
    );
    expect(delta.toString()).toBe("5.5");
  });

  it("computes a negative delta when the target is below the current value", () => {
    const delta = computeAdjustmentDelta(
      new Prisma.Decimal("10.000"),
      new Prisma.Decimal("4.250"),
    );
    expect(delta.toString()).toBe("-5.75");
  });

  it("computes a zero delta when target equals current", () => {
    const delta = computeAdjustmentDelta(
      new Prisma.Decimal("10.000"),
      new Prisma.Decimal("10.000"),
    );
    expect(delta.isZero()).toBe(true);
  });

  it("uses exact Decimal arithmetic, never floating-point approximation", () => {
    // A classic floating-point trap: 0.1 + 0.2 !== 0.3 in JS numbers.
    const delta = computeAdjustmentDelta(
      new Prisma.Decimal("0.1"),
      new Prisma.Decimal("0.3"),
    );
    expect(delta.toString()).toBe("0.2");
  });
});

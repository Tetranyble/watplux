import { describe, expect, it } from "vitest";

import {
  isValidCompareAtPrice,
  isValidMinorUnitAmount,
} from "@/src/modules/catalog/domain/money";

describe("isValidMinorUnitAmount", () => {
  it("accepts a positive integer", () => {
    expect(isValidMinorUnitAmount(150000)).toBe(true);
  });

  it("accepts zero — a legitimate free/promotional price", () => {
    expect(isValidMinorUnitAmount(0)).toBe(true);
  });

  it("rejects a float", () => {
    expect(isValidMinorUnitAmount(150000.5)).toBe(false);
  });

  it("rejects a negative number", () => {
    expect(isValidMinorUnitAmount(-1)).toBe(false);
  });
});

describe("isValidCompareAtPrice", () => {
  it("accepts null — no compare-at price set", () => {
    expect(isValidCompareAtPrice(100000, null)).toBe(true);
  });

  it("accepts undefined — no compare-at price supplied", () => {
    expect(isValidCompareAtPrice(100000, undefined)).toBe(true);
  });

  it("accepts a compare-at price equal to the selling price", () => {
    expect(isValidCompareAtPrice(100000, 100000)).toBe(true);
  });

  it("accepts a compare-at price greater than the selling price", () => {
    expect(isValidCompareAtPrice(80000, 100000)).toBe(true);
  });

  it("rejects a compare-at price lower than the selling price", () => {
    expect(isValidCompareAtPrice(100000, 80000)).toBe(false);
  });
});

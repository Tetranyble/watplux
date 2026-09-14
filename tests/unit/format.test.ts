import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDiscountPercent,
  formatMinorUnits,
  formatQuantity,
} from "@/lib/format";

describe("formatMinorUnits (docs/PHASE_9_STOREFRONT_PLAN.md §10/§19)", () => {
  it("formats NGN minor units as a currency string", () => {
    expect(formatMinorUnits(150_000, "NGN")).toContain("1,500");
  });

  it("formats zero correctly", () => {
    expect(formatMinorUnits(0, "NGN")).toMatch(/0(\.00)?/);
  });

  it("falls back to a plain numeric string for an invalid currency code rather than throwing", () => {
    expect(() => formatMinorUnits(1000, "NOTACURRENCY")).not.toThrow();
    expect(formatMinorUnits(1000, "NOTACURRENCY")).toBe("NOTACURRENCY 10.00");
  });
});

describe("formatDiscountPercent", () => {
  it("computes a whole-number percentage off", () => {
    expect(formatDiscountPercent(75_000, 100_000)).toBe(25);
  });

  it("returns 0 when there is no real discount", () => {
    expect(formatDiscountPercent(100_000, 100_000)).toBe(0);
    expect(formatDiscountPercent(100_000, 50_000)).toBe(0); // compareAt below price — not a discount
    expect(formatDiscountPercent(100_000, 0)).toBe(0);
  });
});

describe("formatQuantity", () => {
  it("renders a whole number with no decimal point", () => {
    expect(formatQuantity(3)).toBe("3");
  });

  it("renders a fractional quantity with trailing zeros trimmed", () => {
    expect(formatQuantity(2.5)).toBe("2.5");
    expect(formatQuantity(2.5)).not.toContain("2.500");
  });

  it("respects DECIMAL(12,3) precision (up to 3 decimal places)", () => {
    expect(formatQuantity(1.125)).toBe("1.125");
  });
});

describe("formatDate", () => {
  it("formats an ISO date string as a human-readable date", () => {
    const formatted = formatDate("2026-01-15T00:00:00.000Z");
    expect(formatted).toMatch(/2026/);
  });
});

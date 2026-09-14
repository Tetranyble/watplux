import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  computeLineTotal,
  computeOrderTotals,
  roundMinorUnits,
} from "@/src/modules/order/domain/order-totals";

describe("roundMinorUnits", () => {
  it("rounds half up to the nearest whole kobo", () => {
    expect(roundMinorUnits(new Prisma.Decimal("100.5"))).toBe(101);
    expect(roundMinorUnits(new Prisma.Decimal("100.4"))).toBe(100);
    expect(roundMinorUnits(new Prisma.Decimal("100.49999"))).toBe(100);
  });

  it("uses exact Decimal arithmetic, never floating-point approximation", () => {
    // 0.1 + 0.2 !== 0.3 in JS numbers — this must not leak into money math.
    const value = new Prisma.Decimal("0.1").plus("0.2").times(1000);
    expect(roundMinorUnits(value)).toBe(300);
  });
});

describe("computeLineTotal", () => {
  it("computes the rounded product of unitPriceMinor and quantity", () => {
    const result = computeLineTotal({
      unitPriceMinor: 150_000,
      quantity: new Prisma.Decimal("2"),
    });
    expect(result.lineTotalMinor).toBe(300_000);
    expect(result.discountMinor).toBe(0);
    expect(result.taxMinor).toBe(0);
  });

  it("handles a fractional quantity correctly, rounded to the nearest kobo", () => {
    const result = computeLineTotal({
      unitPriceMinor: 1000,
      quantity: new Prisma.Decimal("2.5"),
    });
    expect(result.lineTotalMinor).toBe(2500);
  });

  it("rounds a genuinely fractional-kobo product half up", () => {
    // 333 * 0.005 = 1.665 -> rounds to 2
    const result = computeLineTotal({
      unitPriceMinor: 333,
      quantity: new Prisma.Decimal("0.005"),
    });
    expect(result.lineTotalMinor).toBe(2);
  });

  it("discountMinor/taxMinor are always 0 for Phase 6 (no per-line engine built)", () => {
    const result = computeLineTotal({
      unitPriceMinor: 500_000,
      quantity: new Prisma.Decimal("1"),
    });
    expect(result.discountMinor).toBe(0);
    expect(result.taxMinor).toBe(0);
  });
});

describe("computeOrderTotals", () => {
  it("computes subtotal/total satisfying chk_orders_total_arithmetic exactly", () => {
    const lines = [
      computeLineTotal({
        unitPriceMinor: 100_000,
        quantity: new Prisma.Decimal("2"),
      }),
      computeLineTotal({
        unitPriceMinor: 50_000,
        quantity: new Prisma.Decimal("3"),
      }),
    ];
    const totals = computeOrderTotals({
      lines,
      orderLevelDiscountMinor: 10_000,
      deliveryFeeMinor: 5_000,
      orderLevelTaxMinor: 2_000,
    });

    expect(totals.subtotalMinor).toBe(350_000); // 200_000 + 150_000
    expect(totals.discountMinor).toBe(10_000);
    expect(totals.deliveryFeeMinor).toBe(5_000);
    expect(totals.taxMinor).toBe(2_000);
    // The exact DB CHECK constraint formula:
    // total = subtotal - discount + deliveryFee + tax
    expect(totals.totalMinor).toBe(
      totals.subtotalMinor -
        totals.discountMinor +
        totals.deliveryFeeMinor +
        totals.taxMinor,
    );
    expect(totals.totalMinor).toBe(347_000);
  });

  it("defaults to zero discount/delivery/tax for a minimal order", () => {
    const lines = [
      computeLineTotal({
        unitPriceMinor: 100_000,
        quantity: new Prisma.Decimal("1"),
      }),
    ];
    const totals = computeOrderTotals({
      lines,
      orderLevelDiscountMinor: 0,
      deliveryFeeMinor: 0,
      orderLevelTaxMinor: 0,
    });
    expect(totals.subtotalMinor).toBe(100_000);
    expect(totals.totalMinor).toBe(100_000);
  });

  it("handles multiple lines summing correctly with fractional quantities", () => {
    const lines = [
      computeLineTotal({
        unitPriceMinor: 1000,
        quantity: new Prisma.Decimal("1.5"),
      }),
      computeLineTotal({
        unitPriceMinor: 2000,
        quantity: new Prisma.Decimal("0.25"),
      }),
    ];
    const totals = computeOrderTotals({
      lines,
      orderLevelDiscountMinor: 0,
      deliveryFeeMinor: 0,
      orderLevelTaxMinor: 0,
    });
    // 1000*1.5=1500, 2000*0.25=500 -> subtotal 2000
    expect(totals.subtotalMinor).toBe(2000);
  });
});

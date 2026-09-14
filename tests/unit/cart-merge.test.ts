import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { computeMergedCartLines } from "@/src/modules/cart/merge";

function line(id: number, quantity: string) {
  return {
    productVariantId: BigInt(id),
    quantity: new Prisma.Decimal(quantity),
  };
}

function guestLine(id: number, quantity: string, isVariantActive = true) {
  return { ...line(id, quantity), isVariantActive };
}

/** Pure guest->authenticated merge policy (docs/PHASE_7_CART_CHECKOUT_PLAN.md
 * §6) — given two item lists, produce the merged result. Zero I/O. */
describe("computeMergedCartLines", () => {
  it("passes through user-only lines unchanged", () => {
    const result = computeMergedCartLines([line(1, "2")], []);
    expect(result).toHaveLength(1);
    expect(result[0]!.productVariantId).toBe(BigInt(1));
    expect(result[0]!.quantity.toString()).toBe("2");
  });

  it("passes through guest-only (active) lines unchanged", () => {
    const result = computeMergedCartLines([], [guestLine(1, "3")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity.toString()).toBe("3");
  });

  it("sums quantities for a variant present in both carts", () => {
    const result = computeMergedCartLines([line(1, "2")], [guestLine(1, "3")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity.toString()).toBe("5");
  });

  it("drops an inactive/archived guest variant entirely — never copied, never summed", () => {
    const result = computeMergedCartLines(
      [line(1, "2")],
      [guestLine(1, "3", false), guestLine(2, "1", false)],
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.productVariantId).toBe(BigInt(1));
    expect(result[0]!.quantity.toString()).toBe("2");
  });

  it("handles a genuinely mixed set: overlapping, user-only, guest-only, dropped", () => {
    const result = computeMergedCartLines(
      [line(1, "2"), line(2, "1")],
      [guestLine(1, "3"), guestLine(3, "4"), guestLine(4, "5", false)],
    );
    const byId = new Map(
      result.map((r) => [r.productVariantId, r.quantity.toString()]),
    );
    expect(byId.get(BigInt(1))).toBe("5"); // overlap: 2 + 3
    expect(byId.get(BigInt(2))).toBe("1"); // user-only
    expect(byId.get(BigInt(3))).toBe("4"); // guest-only, active
    expect(byId.has(BigInt(4))).toBe(false); // dropped, inactive
  });

  it("supports fractional (DECIMAL(12,3)) quantities exactly, never floating-point approximation", () => {
    const result = computeMergedCartLines(
      [line(1, "0.1")],
      [guestLine(1, "0.2")],
    );
    expect(result[0]!.quantity.toString()).toBe("0.3");
  });

  it("empty inputs produce an empty result", () => {
    expect(computeMergedCartLines([], [])).toEqual([]);
  });
});

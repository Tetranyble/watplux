import { describe, expect, it } from "vitest";

import { generateOrderNumber } from "@/src/modules/order/order-number";

describe("generateOrderNumber", () => {
  it("matches the exact ORD-YYYYMMDD-XXXXXX format", () => {
    const fixedDate = new Date("2026-08-08T12:34:56.000Z");
    const orderNumber = generateOrderNumber(fixedDate);
    expect(orderNumber).toMatch(/^ORD-20260808-[A-Z0-9]{6}$/);
  });

  it("stays well under the orders.order_number column's VarChar(30) limit", () => {
    const orderNumber = generateOrderNumber(
      new Date("2026-08-08T00:00:00.000Z"),
    );
    expect(orderNumber.length).toBeLessThanOrEqual(30);
  });

  it("is not sequential/predictable — two calls produce different suffixes", () => {
    const fixedDate = new Date("2026-08-08T00:00:00.000Z");
    const a = generateOrderNumber(fixedDate);
    const b = generateOrderNumber(fixedDate);
    // Same date prefix, astronomically unlikely to collide on the random suffix.
    expect(a.slice(0, 13)).toBe(b.slice(0, 13));
    expect(a).not.toBe(b);
  });
});

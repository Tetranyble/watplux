import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { deltasForMovementType } from "@/src/modules/inventory/domain/movement-semantics";
import type { MagnitudeBasedMovementType } from "@/src/modules/inventory/domain/movement-semantics";

/** Every one of the five magnitude-based types, tested against
 * docs/PHASE_5_INVENTORY_PLAN.md §3's table directly. */
const CASES: Array<{
  type: MagnitudeBasedMovementType;
  expectedOnHand: string;
  expectedReserved: string;
}> = [
  { type: "RESTOCK", expectedOnHand: "10", expectedReserved: "0" },
  { type: "RESERVE", expectedOnHand: "0", expectedReserved: "10" },
  { type: "RELEASE", expectedOnHand: "0", expectedReserved: "-10" },
  { type: "SALE", expectedOnHand: "-10", expectedReserved: "-10" },
  { type: "RETURN", expectedOnHand: "10", expectedReserved: "0" },
];

describe("deltasForMovementType", () => {
  const quantity = new Prisma.Decimal(10);

  for (const testCase of CASES) {
    it(`${testCase.type}: onHandDelta=${testCase.expectedOnHand}, reservedDelta=${testCase.expectedReserved}`, () => {
      const result = deltasForMovementType(testCase.type, quantity);
      expect(result.onHandDelta.toString()).toBe(testCase.expectedOnHand);
      expect(result.reservedDelta.toString()).toBe(testCase.expectedReserved);
    });
  }

  it("SALE decrements both on-hand and reserved together (never one without the other)", () => {
    const result = deltasForMovementType("SALE", quantity);
    expect(result.onHandDelta.equals(result.reservedDelta)).toBe(true);
  });

  it("scales correctly for a fractional quantity", () => {
    const result = deltasForMovementType("RESERVE", new Prisma.Decimal("2.5"));
    expect(result.reservedDelta.toString()).toBe("2.5");
    expect(result.onHandDelta.toString()).toBe("0");
  });
});

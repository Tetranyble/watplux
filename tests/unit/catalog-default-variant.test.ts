import { describe, expect, it } from "vitest";

import { pickReplacementDefault } from "@/src/modules/catalog/default-variant";

describe("pickReplacementDefault", () => {
  it("returns null for an empty candidate list", () => {
    expect(pickReplacementDefault([])).toBeNull();
  });

  it("returns the sole candidate when there is exactly one", () => {
    const candidate = { id: BigInt(5), sortOrder: 3 };
    expect(pickReplacementDefault([candidate])).toEqual(candidate);
  });

  it("picks the lowest sortOrder among several candidates", () => {
    const candidates = [
      { id: BigInt(1), sortOrder: 5 },
      { id: BigInt(2), sortOrder: 1 },
      { id: BigInt(3), sortOrder: 3 },
    ];
    expect(pickReplacementDefault(candidates)).toEqual({
      id: BigInt(2),
      sortOrder: 1,
    });
  });

  it("breaks a sortOrder tie by the smaller id", () => {
    const candidates = [
      { id: BigInt(10), sortOrder: 0 },
      { id: BigInt(3), sortOrder: 0 },
      { id: BigInt(7), sortOrder: 0 },
    ];
    expect(pickReplacementDefault(candidates)).toEqual({
      id: BigInt(3),
      sortOrder: 0,
    });
  });

  it("is order-independent — the result doesn't depend on input ordering", () => {
    const a = { id: BigInt(1), sortOrder: 5 };
    const b = { id: BigInt(2), sortOrder: 1 };
    const c = { id: BigInt(3), sortOrder: 1 };
    expect(pickReplacementDefault([a, b, c])).toEqual(
      pickReplacementDefault([c, b, a]),
    );
  });
});

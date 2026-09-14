import { describe, expect, it } from "vitest";

import {
  isValidSpecKeyShape,
  normalizeSpecKey,
} from "@/src/modules/catalog/domain/specification-key";

describe("normalizeSpecKey", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(normalizeSpecKey("Cell Type")).toBe("cell_type");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSpecKey("  cycle_life  ")).toBe("cycle_life");
  });

  it("converts hyphens to underscore, then strips remaining disallowed punctuation", () => {
    expect(normalizeSpecKey("cell-type!")).toBe("cell_type");
  });

  it("collapses internal whitespace runs to a single underscore", () => {
    expect(normalizeSpecKey("depth   of    discharge")).toBe(
      "depth_of_discharge",
    );
  });

  it("is idempotent — normalizing an already-normalized key is a no-op", () => {
    const normalized = normalizeSpecKey("Cell Type");
    expect(normalizeSpecKey(normalized)).toBe(normalized);
  });

  it("makes near-duplicate spellings converge to the same key", () => {
    expect(normalizeSpecKey("Cell Type")).toBe(normalizeSpecKey("cell_type"));
    expect(normalizeSpecKey("cell-type ")).toBe(normalizeSpecKey("CELL TYPE"));
  });
});

describe("isValidSpecKeyShape", () => {
  it("accepts a normalized key", () => {
    expect(isValidSpecKeyShape("cell_type")).toBe(true);
  });

  it("rejects uppercase or spaces (i.e., anything not yet normalized)", () => {
    expect(isValidSpecKeyShape("Cell Type")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidSpecKeyShape("")).toBe(false);
  });

  it("rejects a key longer than 100 characters", () => {
    expect(isValidSpecKeyShape("a".repeat(101))).toBe(false);
  });

  it("accepts a key at exactly 100 characters", () => {
    expect(isValidSpecKeyShape("a".repeat(100))).toBe(true);
  });
});

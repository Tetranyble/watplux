import { describe, expect, it } from "vitest";

import {
  isValidSlugShape,
  slugify,
  suffixSlug,
} from "@/src/modules/catalog/slug";

describe("slugify", () => {
  it("lowercases and hyphenates a normal name", () => {
    expect(slugify("450W Mono Solar Panel")).toBe("450w-mono-solar-panel");
  });

  it("strips diacritics", () => {
    expect(slugify("Câble Électrique")).toBe("cable-electrique");
  });

  it("collapses runs of punctuation into a single hyphen", () => {
    expect(slugify("Panel -- 450W // Black!!")).toBe("panel-450w-black");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("--Solar Panel--")).toBe("solar-panel");
  });

  it("is deterministic for the same input", () => {
    expect(slugify("Charge Controller 40A")).toBe(
      slugify("Charge Controller 40A"),
    );
  });

  it("returns an empty string for input with no alphanumeric characters", () => {
    // Not "™®©" — NFKD normalization decomposes "™" into the letters "TM",
    // so that input isn't actually a case of "no alphanumeric characters"
    // once normalized. "***" has no letter decomposition of any kind.
    expect(slugify("***")).toBe("");
  });

  it("is idempotent when applied to its own output", () => {
    const once = slugify("450W Mono Solar Panel");
    expect(slugify(once)).toBe(once);
  });
});

describe("isValidSlugShape", () => {
  it("accepts a well-formed slug", () => {
    expect(isValidSlugShape("450w-mono-solar-panel")).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(isValidSlugShape("450W-mono")).toBe(false);
  });

  it("rejects leading/trailing hyphens", () => {
    expect(isValidSlugShape("-mono-panel-")).toBe(false);
  });

  it("rejects doubled hyphens", () => {
    expect(isValidSlugShape("mono--panel")).toBe(false);
  });

  it("rejects spaces and other characters", () => {
    expect(isValidSlugShape("mono panel")).toBe(false);
    expect(isValidSlugShape("mono_panel")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidSlugShape("")).toBe(false);
  });
});

describe("suffixSlug", () => {
  it("returns the base slug unchanged on attempt 1", () => {
    expect(suffixSlug("solar-panel", 1)).toBe("solar-panel");
  });

  it("appends -2, -3, ... on subsequent attempts", () => {
    expect(suffixSlug("solar-panel", 2)).toBe("solar-panel-2");
    expect(suffixSlug("solar-panel", 3)).toBe("solar-panel-3");
  });
});

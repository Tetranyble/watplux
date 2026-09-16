import { describe, expect, it } from "vitest";

import {
  ForbiddenError,
  isForbiddenError,
  isNotFoundError,
  NotFoundError,
} from "@/lib/errors";

describe("serialized application error matching", () => {
  it("matches live domain error instances", () => {
    expect(isNotFoundError(new NotFoundError())).toBe(true);
    expect(isForbiddenError(new ForbiddenError())).toBe(true);
  });

  it("matches errors serialized across a cache boundary", () => {
    expect(isNotFoundError({ name: "NotFoundError" })).toBe(true);
    expect(isNotFoundError({ code: "NOT_FOUND" })).toBe(true);
    expect(isForbiddenError({ name: "ForbiddenError" })).toBe(true);
    expect(isForbiddenError({ code: "FORBIDDEN" })).toBe(true);
  });

  it("does not mistake unrelated failures for deliberate route states", () => {
    expect(isNotFoundError(new Error("database unavailable"))).toBe(false);
    expect(isForbiddenError({ code: "VALIDATION_ERROR" })).toBe(false);
  });
});

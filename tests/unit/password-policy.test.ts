import { describe, expect, it } from "vitest";

import { checkPasswordPolicy } from "@/src/modules/auth/domain/password-policy";

describe("checkPasswordPolicy", () => {
  it("accepts a password meeting every rule", () => {
    const result = checkPasswordPolicy("Sup3rSecret");
    expect(result.valid).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("rejects a password that is too short", () => {
    const result = checkPasswordPolicy("Ab1");
    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("rejects a password with no uppercase letter", () => {
    const result = checkPasswordPolicy("lowercase123");
    expect(result.valid).toBe(false);
  });

  it("rejects a password with no digit", () => {
    const result = checkPasswordPolicy("NoDigitsHere");
    expect(result.valid).toBe(false);
  });

  it("rejects a purely numeric, long password (weak despite length)", () => {
    const result = checkPasswordPolicy("1234567890123");
    expect(result.valid).toBe(false);
  });
});

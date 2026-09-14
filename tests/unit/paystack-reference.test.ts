import { describe, expect, it } from "vitest";

import { generatePaystackSafeReference } from "@/src/integrations/paystack/reference";

/** Paystack's documented reference character set: alphanumeric plus `-`,
 * `.`, `=` only (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §8.3) — never
 * base64url's `_`. */
const PAYSTACK_SAFE_CHARSET = /^[A-Za-z0-9\-.=]+$/;

describe("generatePaystackSafeReference", () => {
  it("produces a reference using only Paystack's documented safe character set", () => {
    for (let i = 0; i < 20; i++) {
      const reference = generatePaystackSafeReference("CHKOUT");
      expect(reference).toMatch(PAYSTACK_SAFE_CHARSET);
      expect(reference).not.toContain("_");
    }
  });

  it("includes the given prefix", () => {
    expect(generatePaystackSafeReference("PAY")).toMatch(/^PAY-/);
    expect(generatePaystackSafeReference("CHKOUT")).toMatch(/^CHKOUT-/);
  });

  it("is not predictable — two calls with the same prefix produce different references", () => {
    const a = generatePaystackSafeReference("CHKOUT");
    const b = generatePaystackSafeReference("CHKOUT");
    expect(a).not.toBe(b);
  });

  it("stays comfortably under the payment_attempts.paystack_reference column's VarChar(100) limit", () => {
    const reference = generatePaystackSafeReference("CHKOUT");
    expect(reference.length).toBeLessThanOrEqual(100);
  });
});

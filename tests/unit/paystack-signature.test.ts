import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyPaystackSignature } from "@/src/integrations/paystack/signature";

describe("verifyPaystackSignature", () => {
  const secret = "test-secret-key";
  const body = JSON.stringify({ event: "charge.success", data: { id: 123 } });

  function sign(rawBody: string, key: string): string {
    return createHmac("sha512", key).update(rawBody).digest("hex");
  }

  it("accepts a correctly signed body", () => {
    const signature = sign(body, secret);
    expect(verifyPaystackSignature(body, signature, secret)).toBe(true);
  });

  it("rejects a tampered body (same signature, different content)", () => {
    const signature = sign(body, secret);
    const tampered = JSON.stringify({
      event: "charge.success",
      data: { id: 999 },
    });
    expect(verifyPaystackSignature(tampered, signature, secret)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const wrongSignature = sign(body, "a-different-secret");
    expect(verifyPaystackSignature(body, wrongSignature, secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyPaystackSignature(body, null, secret)).toBe(false);
    expect(verifyPaystackSignature(body, undefined, secret)).toBe(false);
  });

  it("rejects an empty-string signature", () => {
    expect(verifyPaystackSignature(body, "", secret)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(() => verifyPaystackSignature(body, "short", secret)).not.toThrow();
    expect(verifyPaystackSignature(body, "short", secret)).toBe(false);
  });

  it("uses SHA-512, not SHA-256 — a SHA-256 signature of the same body is rejected", () => {
    const sha256Signature = createHmac("sha256", secret)
      .update(body)
      .digest("hex");
    expect(verifyPaystackSignature(body, sha256Signature, secret)).toBe(false);
  });
});

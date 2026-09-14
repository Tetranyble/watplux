import { describe, expect, it } from "vitest";

import { generateRawToken, hashToken } from "@/src/integrations/crypto/tokens";

describe("token generation and hashing", () => {
  it("generates a high-entropy, URL-safe raw token", () => {
    const token = generateRawToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).not.toMatch(/[+/=]/); // base64url, not base64
  });

  it("generates a different token on every call", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toBe(b);
  });

  it("hashes deterministically (same input -> same hash)", () => {
    const token = generateRawToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("produces different hashes for different tokens", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(hashToken(a)).not.toBe(hashToken(b));
  });

  it("never returns the raw token as a substring of its own hash", () => {
    const token = generateRawToken();
    const hash = hashToken(token);
    expect(hash).not.toContain(token);
  });
});

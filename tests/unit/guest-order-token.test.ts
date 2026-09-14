import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  generateGuestOrderToken,
  verifyGuestOrderToken,
} from "@/src/integrations/crypto/guest-order-token";

const SECRET = "a".repeat(32);
const NOW = new Date("2026-01-01T00:00:00.000Z");
const ONE_HOUR = 60 * 60;

describe("guest order token (docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A)", () => {
  it("a validly signed, unexpired token verifies and returns the correct orderId", () => {
    const token = generateGuestOrderToken(BigInt(42), SECRET, ONE_HOUR, NOW);
    expect(token).not.toBeNull();
    const result = verifyGuestOrderToken(token!, SECRET, NOW);
    expect(result).toEqual({ orderId: BigInt(42) });
  });

  it("an expired token fails verification", () => {
    const token = generateGuestOrderToken(BigInt(42), SECRET, ONE_HOUR, NOW);
    const later = new Date(NOW.getTime() + (ONE_HOUR + 1) * 1000);
    expect(verifyGuestOrderToken(token!, SECRET, later)).toBeNull();
  });

  it("a token one second before its expiry still verifies (boundary check)", () => {
    const token = generateGuestOrderToken(BigInt(42), SECRET, ONE_HOUR, NOW);
    const justBefore = new Date(NOW.getTime() + (ONE_HOUR - 1) * 1000);
    expect(verifyGuestOrderToken(token!, SECRET, justBefore)).toEqual({
      orderId: BigInt(42),
    });
  });

  it("a malformed token (no signature separator) fails verification", () => {
    expect(verifyGuestOrderToken("not-a-real-token", SECRET, NOW)).toBeNull();
  });

  it("a malformed token (garbage payload) fails verification", () => {
    expect(
      verifyGuestOrderToken("garbage.alsogarbage", SECRET, NOW),
    ).toBeNull();
  });

  it("a tampered payload (valid shape, wrong signature) fails verification", () => {
    const token = generateGuestOrderToken(BigInt(42), SECRET, ONE_HOUR, NOW)!;
    const [payloadB64] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ orderId: "999", exp: 9999999999 }),
    ).toString("base64url");
    const tampered = `${forgedPayload}.${token.split(".")[1]}`;
    expect(tampered).not.toBe(token);
    expect(payloadB64).toBeDefined();
    expect(verifyGuestOrderToken(tampered, SECRET, NOW)).toBeNull();
  });

  it("a token signed for a different order returns that order's id, not the caller's expected one — callers MUST compare orderId themselves", () => {
    const token = generateGuestOrderToken(BigInt(1), SECRET, ONE_HOUR, NOW)!;
    const result = verifyGuestOrderToken(token, SECRET, NOW);
    expect(result?.orderId).toBe(BigInt(1));
    expect(result?.orderId).not.toBe(BigInt(2));
  });

  it("a token verified with the wrong secret fails", () => {
    const token = generateGuestOrderToken(BigInt(42), SECRET, ONE_HOUR, NOW)!;
    expect(verifyGuestOrderToken(token, "b".repeat(32), NOW)).toBeNull();
  });

  it("generateGuestOrderToken returns null when no secret is configured — fails closed, never signs with an implicit default", () => {
    expect(
      generateGuestOrderToken(BigInt(42), undefined, ONE_HOUR, NOW),
    ).toBeNull();
  });

  it("verifyGuestOrderToken returns null when no secret is configured, even for an otherwise well-formed token", () => {
    const token = generateGuestOrderToken(BigInt(42), SECRET, ONE_HOUR, NOW)!;
    expect(verifyGuestOrderToken(token, undefined, NOW)).toBeNull();
  });

  it("a token with a non-numeric orderId claim fails verification", () => {
    const payloadB64 = Buffer.from(
      JSON.stringify({ orderId: "not-a-number", exp: 9999999999 }),
    ).toString("base64url");
    const signature = createHmac("sha256", SECRET)
      .update(payloadB64)
      .digest("base64url");
    expect(
      verifyGuestOrderToken(`${payloadB64}.${signature}`, SECRET, NOW),
    ).toBeNull();
  });
});

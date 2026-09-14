import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature verification (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md
 * §21) — HMAC-SHA512 of the *raw* request body (never a re-serialized/
 * re-parsed version, which can alter whitespace/key order and invalidate
 * the signature) using `PAYSTACK_SECRET_KEY`, compared in constant time.
 * Pure function, no I/O, no business logic — the caller (the webhook
 * ingestion use-case) decides what a `false` result means.
 */
export function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secretKey: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac("sha512", secretKey)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signatureHeader, "utf8");

  // timingSafeEqual throws if buffers differ in length — a length
  // mismatch is itself a legitimate "signature doesn't match" outcome,
  // not an error to propagate.
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

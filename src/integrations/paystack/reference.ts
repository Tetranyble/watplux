import { randomBytes } from "node:crypto";

/**
 * Paystack's documented transaction-reference character set: alphanumeric
 * plus `-`, `.`, `=` only (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §8.3).
 * `src/integrations/crypto/tokens.ts`'s `generateRawToken()`
 * (`randomBytes(32).toString("base64url")`) is NOT safe to reuse here —
 * base64url's alphabet includes `_`, which is outside Paystack's allowed
 * set. Hex (`0-9a-f`) is purely alphanumeric and therefore always safe,
 * at the cost of slightly lower entropy density per character (still 160
 * bits from 20 random bytes, comfortably collision-resistant — the same
 * order of magnitude of entropy `generateRawToken()` provides, and the
 * `paystack_reference` column's own `@unique` constraint is the real
 * safety net regardless, exactly as `order-number.ts`'s precedent
 * already establishes for a similar random-suffix scheme).
 */
export function generatePaystackSafeReference(prefix: string): string {
  return `${prefix}-${randomBytes(20).toString("hex")}`;
}

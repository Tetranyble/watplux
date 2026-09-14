import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless, signed, order-scoped access token — the approved
 * implementation of docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A.
 *
 * Deliberately narrow, not a generic "guest access" mechanism: the only
 * claim it ever carries is `{ orderId, exp }`, and the only thing holding
 * a valid token proves is "the bearer is authorized to read/retry payment
 * status for THIS ONE order, until THIS expiry" — nothing else. It is
 * never stored anywhere (stateless, self-verifying via HMAC, mirroring
 * `src/integrations/paystack/signature.ts`'s existing verify-via-HMAC
 * pattern in this codebase rather than the session/reset-token pattern in
 * `tokens.ts`, which requires a stored hash this token deliberately has
 * none of).
 *
 * Fails closed: if no secret is configured, `generateGuestOrderToken`
 * returns `null` (no token issued — the caller falls back to the
 * non-token guest experience) rather than signing with an insecure
 * default, matching this codebase's established discipline for every
 * other security-sensitive secret (`PAYSTACK_SECRET_KEY`,
 * `INTERNAL_WORKER_SECRET`).
 */

interface GuestOrderTokenPayload {
  orderId: string;
  exp: number;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function generateGuestOrderToken(
  orderId: bigint,
  secret: string | undefined,
  ttlSeconds: number,
  now: Date,
): string | null {
  if (!secret) return null;

  const payload: GuestOrderTokenPayload = {
    orderId: orderId.toString(),
    exp: Math.floor(now.getTime() / 1000) + ttlSeconds,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

/**
 * Verifies signature, structure, AND expiry — never returns a claim
 * unless every one of those holds. Returns `null` (never throws) for any
 * malformed/tampered/expired/wrong-shape input, matching
 * `verifyPaystackSignature`'s "never throws, always a clean boolean/null
 * result" convention.
 */
export function verifyGuestOrderToken(
  token: string,
  secret: string | undefined,
  now: Date,
): { orderId: bigint } | null {
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;

  const expectedSignature = sign(payloadB64, secret);
  const providedBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as GuestOrderTokenPayload).orderId !== "string" ||
    typeof (payload as GuestOrderTokenPayload).exp !== "number"
  ) {
    return null;
  }

  const claim = payload as GuestOrderTokenPayload;
  if (Math.floor(now.getTime() / 1000) >= claim.exp) return null;

  try {
    return { orderId: BigInt(claim.orderId) };
  } catch {
    return null;
  }
}

import { env } from "@/lib/env";
import { verifyGuestOrderToken } from "@/src/integrations/crypto/guest-order-token";

/**
 * The one sanctioned way a Route Handler checks a guest-order token
 * (docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A) — `app/**` may not
 * import `src/integrations/**` directly (eslint boundaries), so this thin
 * use-case is the required seam, exactly like every other integration
 * this codebase already wraps behind a use-case. Returns `true` only if
 * the token is validly signed, unexpired, AND scoped to this exact
 * `orderId` — never true for a token issued for a different order.
 */
export function isValidGuestOrderToken(
  token: string,
  orderId: bigint,
): boolean {
  const verified = verifyGuestOrderToken(
    token,
    env.GUEST_ORDER_TOKEN_SECRET,
    new Date(),
  );
  return verified !== null && verified.orderId === orderId;
}

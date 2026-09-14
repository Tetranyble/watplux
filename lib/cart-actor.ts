import { cookies } from "next/headers";

import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/session";
import { generateRawToken, hashToken } from "@/src/integrations/crypto/tokens";
import {
  GUEST_CART_COOKIE_NAME,
  GUEST_CART_TTL_DAYS,
} from "@/src/modules/cart/constants";
import { guestCartIdentityExists } from "@/src/modules/cart/use-cases/resolve-guest-cart-identity";
import type { CartOwner } from "@/src/modules/cart/types";

/**
 * The Next.js-aware seam between framework and the framework-agnostic
 * cart use-cases (docs/PHASE_7_CART_CHECKOUT_PLAN.md §5) — lives in
 * `lib/` (unclassified by the architecture boundary rules, same as
 * `lib/session.ts`), precisely because use-cases themselves must never
 * import `next/headers` (docs/ARCHITECTURE.md §1).
 */
export type CartActor = CartOwner | { type: "none" };

/**
 * Resolves "who is making this cart request" (plan §5):
 * 1. An authenticated session always wins — a logged-in user is never
 *    treated as a guest even if a stale guest cookie is also present
 *    (that cookie is a merge candidate, not an active identity, plan §6).
 * 2. Otherwise, the guest-cart cookie, if present AND its hash resolves
 *    to a real (any-status) cart.
 * 3. Otherwise, `{ type: "none" }` — a cart is only created lazily, on
 *    the first mutating call, never merely because someone visited a
 *    page (`resolveOrCreateCartOwner` below).
 */
export async function resolveCartActor(): Promise<CartActor> {
  const sessionUser = await getSessionUser();
  if (sessionUser) {
    return { type: "user", userId: sessionUser.id };
  }

  const cookieStore = await cookies();
  const rawToken = cookieStore.get(GUEST_CART_COOKIE_NAME)?.value;
  if (!rawToken) {
    return { type: "none" };
  }

  const guestTokenHash = hashToken(rawToken);
  const exists = await guestCartIdentityExists(guestTokenHash);
  if (!exists) {
    // Expired/invalid/forged cookie value — treated as absent, never an
    // error (plan §5 step 2).
    return { type: "none" };
  }

  return { type: "guest", guestTokenHash };
}

/**
 * Mutation-only variant: promotes a `"none"` identity into a fresh guest
 * identity, issuing the guest-cart cookie as a side effect. Only
 * `addCartItem`'s route calls this — every other cart/checkout route
 * uses the non-promoting `resolveCartActor()` above, since reads,
 * updates, removals, clears, and checkout all require an
 * ALREADY-existing cart (plan §5/§24).
 */
export async function resolveOrCreateCartOwner(): Promise<CartOwner> {
  const actor = await resolveCartActor();
  if (actor.type !== "none") {
    return actor;
  }

  const rawToken = generateRawToken();
  await setGuestCartCookie(rawToken);
  return { type: "guest", guestTokenHash: hashToken(rawToken) };
}

/** Cookie attributes identical to `lib/session.ts`'s `setSessionCookie`
 * (plan §4). */
export async function setGuestCartCookie(rawToken: string): Promise<void> {
  const cookieStore = await cookies();
  const expires = new Date(
    Date.now() + GUEST_CART_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  cookieStore.set(GUEST_CART_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** Called after a successful guest->user merge (plan §6) — a stale guest
 * cookie must never resolve to a `CONVERTED` cart being treated as
 * `ACTIVE` again. */
export async function clearGuestCartCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(GUEST_CART_COOKIE_NAME);
}

export async function getRawGuestCartToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(GUEST_CART_COOKIE_NAME)?.value;
}

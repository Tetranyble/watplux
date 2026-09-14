/** Name of the httpOnly guest-cart cookie (plan §4) — sibling to
 * `src/modules/auth/constants.ts`'s `SESSION_COOKIE_NAME`. */
export const GUEST_CART_COOKIE_NAME = "guest_cart_token";

/** Proposed default TTL for a guest cart / its cookie (plan §4, open
 * question 1) — not specified anywhere in the approved architecture; a
 * concrete default chosen explicitly rather than left undefined. */
export const GUEST_CART_TTL_DAYS = 30;

/** No new RBAC permission is introduced for Cart/Checkout (plan §26). */

export const QUANTITY_DECIMAL_PLACES = 3;

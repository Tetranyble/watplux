import * as cartRepo from "@/src/modules/cart/repo";

/**
 * Framework-agnostic seam for `lib/cart-actor.ts` (plan §5 step 2) — kept
 * as its own tiny use-case, rather than `lib/` importing `repo.ts`
 * directly, so cart data access stays reachable only through this
 * module's use-case layer, matching `lib/session.ts` -> `getCurrentUser`
 * -> `authRepo`'s exact shape.
 */
export async function guestCartIdentityExists(
  guestTokenHash: string,
): Promise<boolean> {
  return cartRepo.guestTokenHashResolvesToCart(guestTokenHash);
}

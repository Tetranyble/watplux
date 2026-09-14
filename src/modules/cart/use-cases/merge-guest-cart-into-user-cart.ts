import * as cartRepo from "@/src/modules/cart/repo";
import { hashToken } from "@/src/integrations/crypto/tokens";

/**
 * Called only from the login use-case's own success path (plan §6 — "not
 * a separate endpoint the client calls"). Both `userId` and
 * `guestTokenHash` are always server-resolved by the caller — never
 * client-supplied.
 */
export async function mergeGuestCartIntoUserCart(
  userId: bigint,
  guestTokenHash: string,
): Promise<{ merged: boolean }> {
  return cartRepo.mergeGuestCartIntoUserCart(userId, guestTokenHash);
}

export async function mergeGuestCartTokenIntoUserCart(
  userId: bigint,
  rawGuestToken: string,
): Promise<{ merged: boolean }> {
  return mergeGuestCartIntoUserCart(userId, hashToken(rawGuestToken));
}

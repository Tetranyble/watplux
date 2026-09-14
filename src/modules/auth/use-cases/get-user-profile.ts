import { NotFoundError } from "@/lib/errors";
import * as authRepo from "@/src/modules/auth/repo";
import {
  toSafeUser,
  type AuthenticatedUser,
  type SafeUser,
} from "@/src/modules/auth/types";

const MANAGE_USERS_PERMISSION = "users.manage";

/**
 * The IDOR-protection template referenced in
 * docs/PHASE_3_AUTH_RBAC_PLAN.md §3.3: ownership OR elevated permission,
 * resolved server-side against the row actually fetched — never by
 * trusting a client-supplied "this is mine" flag. `NotFoundError` (not
 * `ForbiddenError`) is deliberately returned for "user doesn't exist" so
 * this endpoint doesn't distinguish "exists but not yours" from
 * "doesn't exist" for a non-privileged caller trying arbitrary IDs.
 */
export async function getUserProfile(
  requester: AuthenticatedUser,
  targetUserId: bigint,
): Promise<SafeUser> {
  const targetUser = await authRepo.findUserById(targetUserId);
  if (!targetUser) throw new NotFoundError("User not found.");

  const isOwnProfile = targetUser.id === requester.id;
  const canReadAnyProfile = requester.permissions.has(MANAGE_USERS_PERMISSION);

  if (!isOwnProfile && !canReadAnyProfile) {
    throw new NotFoundError("User not found.");
  }

  return toSafeUser(targetUser);
}

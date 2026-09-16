import { cache } from "react";
import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import * as authRepo from "@/src/modules/auth/repo";
import type { AuthenticatedUser } from "@/src/modules/auth/types";

/**
 * Framework seam for Better Auth -> application actor.
 *
 * Better Auth validates the session. The application then resolves its own
 * RBAC permissions from `user_roles -> role_permissions`; business modules
 * continue to receive the same `AuthenticatedUser` shape they used before
 * the migration, so authentication changed without coupling commerce code to
 * an auth vendor.
 */
export const getSessionUser = cache(
  async (): Promise<AuthenticatedUser | null> => {
    // Resolve the request boundary before constructing Better Auth. With Cache
    // Components this suspends prerendering, so runtime secrets are never
    // required while producing the build artifact.
    const requestHeaders = await headers();
    const session = await getAuth().api.getSession({
      headers: requestHeaders,
    });
    if (!session?.user?.id) return null;

    const userId = BigInt(String(session.user.id));
    const user = await authRepo.findUserById(userId);
    if (!user || user.status !== "ACTIVE" || user.deletedAt) return null;

    const permissionKeys = await authRepo.getUserPermissionKeys(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      status: user.status,
      permissions: new Set(permissionKeys),
    };
  },
);

export async function requireSessionUser(): Promise<AuthenticatedUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthorizedError("You must be signed in to do that.");
  }
  return user;
}

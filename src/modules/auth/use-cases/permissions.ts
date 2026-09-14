import { ForbiddenError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";

/**
 * The ONLY sanctioned way any use-case checks authorization
 * (docs/PHASE_3_AUTH_RBAC_PLAN.md §3.1) — never a scattered
 * `user.role === "admin"` string comparison. Permissions are resolved once,
 * server-side, from the database (via `getCurrentUser`'s join through
 * user_roles -> role_permissions), never trusted from client input.
 */
export function hasPermission(
  user: AuthenticatedUser,
  permissionKey: string,
): boolean {
  return user.permissions.has(permissionKey);
}

/** Throws the existing `ForbiddenError` (lib/errors.ts) if the user lacks
 * the permission. This is what every admin-gated use-case calls first,
 * after the framework session seam (`requireSessionUser`). */
export function requirePermission(
  user: AuthenticatedUser,
  permissionKey: string,
): void {
  if (!hasPermission(user, permissionKey)) {
    throw new ForbiddenError(
      `You do not have permission to perform this action (${permissionKey}).`,
    );
  }
}

import { NotFoundError } from "@/lib/errors";
import * as authRepo from "@/src/modules/auth/repo";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { RemoveRoleInput } from "@/src/modules/auth/schema";
import type { AuthenticatedUser } from "@/src/modules/auth/types";

const MANAGE_USERS_PERMISSION = "users.manage";

/** Admin-only — same pattern as `assignRole`. */
export async function removeRole(
  actor: AuthenticatedUser,
  input: RemoveRoleInput,
): Promise<void> {
  requirePermission(actor, MANAGE_USERS_PERMISSION);

  const targetUser = await authRepo.findUserById(input.userId);
  if (!targetUser) throw new NotFoundError("User not found.");

  const role = await authRepo.findRoleByName(input.roleName);
  if (!role) throw new NotFoundError("Role not found.");

  await authRepo.removeRoleFromUser({
    userId: targetUser.id,
    roleId: role.id,
  });

  await authRepo.writeAuditLog({
    actorId: actor.id,
    actorType: "USER",
    action: "auth.role.removed",
    entityType: "user",
    entityId: targetUser.id,
  });
}

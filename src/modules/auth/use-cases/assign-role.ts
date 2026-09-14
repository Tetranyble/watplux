import { NotFoundError } from "@/lib/errors";
import * as authRepo from "@/src/modules/auth/repo";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AssignRoleInput } from "@/src/modules/auth/schema";
import type { AuthenticatedUser } from "@/src/modules/auth/types";

const MANAGE_USERS_PERMISSION = "users.manage";

/**
 * Admin-only. `requirePermission` runs first, inside the use-case — never
 * only at the route layer (docs/PHASE_3_AUTH_RBAC_PLAN.md §3.2) — so a
 * `customer`-role caller is denied even if they invoke this function
 * directly, bypassing any UI. This is the concrete target for the
 * privilege-escalation tests (§26 of the Phase 3 brief).
 */
export async function assignRole(
  actor: AuthenticatedUser,
  input: AssignRoleInput,
): Promise<void> {
  requirePermission(actor, MANAGE_USERS_PERMISSION);

  const targetUser = await authRepo.findUserById(input.userId);
  if (!targetUser) throw new NotFoundError("User not found.");

  const role = await authRepo.findRoleByName(input.roleName);
  if (!role) throw new NotFoundError("Role not found.");

  await authRepo.assignRoleToUser({
    userId: targetUser.id,
    roleId: role.id,
    assignedBy: actor.id,
  });

  await authRepo.writeAuditLog({
    actorId: actor.id,
    actorType: "USER",
    action: "auth.role.assigned",
    entityType: "user",
    entityId: targetUser.id,
  });
}

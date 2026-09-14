import { NotFoundError } from "@/lib/errors";
import * as authRepo from "@/src/modules/auth/repo";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";

export async function forceLogoutUser(
  actor: AuthenticatedUser,
  targetUserId: bigint,
): Promise<void> {
  requirePermission(actor, "users.manage");
  const target = await authRepo.findUserById(targetUserId);
  if (!target || target.deletedAt) throw new NotFoundError("User not found.");
  await authRepo.deleteAllSessionsForUser(targetUserId);
  await authRepo.writeAuditLog({
    actorId: actor.id,
    actorType: "USER",
    action: "user.sessions.revoked",
    entityType: "user",
    entityId: targetUserId,
  });
}

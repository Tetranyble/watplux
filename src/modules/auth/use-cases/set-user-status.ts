import { ForbiddenError, NotFoundError } from "@/lib/errors";
import * as authRepo from "@/src/modules/auth/repo";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";

export async function setUserStatus(
  actor: AuthenticatedUser,
  targetUserId: bigint,
  status: "ACTIVE" | "SUSPENDED",
): Promise<void> {
  requirePermission(actor, "users.manage");
  if (actor.id === targetUserId && status === "SUSPENDED") {
    throw new ForbiddenError("You cannot suspend your own account.");
  }
  const target = await authRepo.findUserById(targetUserId);
  if (!target || target.deletedAt) throw new NotFoundError("User not found.");
  await authRepo.setUserStatus(targetUserId, status);
  await authRepo.writeAuditLog({
    actorId: actor.id,
    actorType: "USER",
    action: status === "SUSPENDED" ? "user.suspended" : "user.activated",
    entityType: "user",
    entityId: targetUserId,
  });
}

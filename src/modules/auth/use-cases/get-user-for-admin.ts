import { NotFoundError } from "@/lib/errors";
import * as authRepo from "@/src/modules/auth/repo";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";

/** Administrative projection only; credential/session internals never leave repo.ts. */
export async function getUserForAdmin(
  actor: AuthenticatedUser,
  userId: bigint,
) {
  requirePermission(actor, "users.manage");
  const user = await authRepo.findUserForAdmin(userId);
  if (!user) throw new NotFoundError("User not found.");
  return user;
}

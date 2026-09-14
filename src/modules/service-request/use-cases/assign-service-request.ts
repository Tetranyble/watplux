import { NotFoundError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import * as authRepo from "@/src/modules/auth/repo";
import { PERMISSION_SERVICE_REQUESTS_UPDATE } from "@/src/modules/service-request/constants";
import * as repo from "@/src/modules/service-request/repo";

export async function assignServiceRequest(
  actor: AuthenticatedUser,
  id: bigint,
  assignedTo: bigint | null,
): Promise<void> {
  requirePermission(actor, PERMISSION_SERVICE_REQUESTS_UPDATE);
  const request = await repo.findServiceRequestById(id);
  if (!request) throw new NotFoundError("Service request not found.");
  if (assignedTo !== null) {
    const assignee = await authRepo.findUserById(assignedTo);
    if (!assignee || assignee.deletedAt || assignee.status !== "ACTIVE") {
      throw new NotFoundError("Assignee not found.");
    }
    const permissions = await authRepo.getUserPermissionKeys(assignedTo);
    if (!permissions.includes(PERMISSION_SERVICE_REQUESTS_UPDATE)) {
      throw new NotFoundError("Assignee is not an active service operator.");
    }
  }
  await repo.assignServiceRequestAndAudit({
    id,
    assignedTo,
    actorId: actor.id,
    previousAssignedTo: request.assignedTo,
  });
}

export async function assignServiceRequestToSelf(
  actor: AuthenticatedUser,
  id: bigint,
): Promise<void> {
  return assignServiceRequest(actor, id, actor.id);
}

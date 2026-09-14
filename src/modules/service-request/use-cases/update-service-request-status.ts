import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import { PERMISSION_SERVICE_REQUESTS_UPDATE } from "@/src/modules/service-request/constants";
import { canTransitionServiceRequest } from "@/src/modules/service-request/domain";
import * as repo from "@/src/modules/service-request/repo";
import type { ServiceRequestStatus } from "@prisma/client";

export async function updateServiceRequestStatus(
  actor: AuthenticatedUser,
  id: bigint,
  status: ServiceRequestStatus,
): Promise<void> {
  requirePermission(actor, PERMISSION_SERVICE_REQUESTS_UPDATE);
  const current = await repo.findServiceRequestById(id);
  if (!current) throw new NotFoundError("Service request not found.");
  if (current.status === status) return;
  if (!canTransitionServiceRequest(current.status, status)) {
    throw new ValidationError(
      `Cannot move a service request from ${current.status} to ${status}.`,
    );
  }
  const updated = await repo.updateServiceRequestStatusAndAudit({
    id,
    fromStatus: current.status,
    toStatus: status,
    actorId: actor.id,
  });
  if (!updated) {
    throw new ConflictError(
      "The service request changed while you were updating it. Refresh and try again.",
    );
  }
}

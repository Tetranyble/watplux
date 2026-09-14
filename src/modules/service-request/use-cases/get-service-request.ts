import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { hasPermission } from "@/src/modules/auth/use-cases/permissions";
import { PERMISSION_SERVICE_REQUESTS_READ } from "@/src/modules/service-request/constants";
import * as repo from "@/src/modules/service-request/repo";
import { toServiceRequestRecord } from "@/src/modules/service-request/use-cases/shared";

export async function getServiceRequest(actor: AuthenticatedUser, id: bigint) {
  const row = await repo.findServiceRequestById(id);
  if (!row) throw new NotFoundError("Service request not found.");
  const isOwner = row.userId === actor.id;
  if (!isOwner && !hasPermission(actor, PERMISSION_SERVICE_REQUESTS_READ)) {
    throw new ForbiddenError("You cannot view this service request.");
  }
  return toServiceRequestRecord(row);
}

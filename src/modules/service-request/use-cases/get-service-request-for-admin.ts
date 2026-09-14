import { NotFoundError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import { PERMISSION_SERVICE_REQUESTS_READ } from "@/src/modules/service-request/constants";
import * as repo from "@/src/modules/service-request/repo";
import { toServiceRequestRecord } from "@/src/modules/service-request/use-cases/shared";

export async function getServiceRequestForAdmin(
  actor: AuthenticatedUser,
  id: bigint,
) {
  requirePermission(actor, PERMISSION_SERVICE_REQUESTS_READ);
  const row = await repo.findServiceRequestById(id);
  if (!row) throw new NotFoundError("Service request not found.");
  return toServiceRequestRecord(row);
}

import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_SERVICE_REQUESTS_READ } from "@/src/modules/service-request/constants";
import * as repo from "@/src/modules/service-request/repo";
import type { ListServiceRequestsInput } from "@/src/modules/service-request/schema";
import { toServiceRequestRecord } from "@/src/modules/service-request/use-cases/shared";

export async function listServiceRequestsForAdmin(
  actor: AuthenticatedUser,
  input: ListServiceRequestsInput,
) {
  requirePermission(actor, PERMISSION_SERVICE_REQUESTS_READ);
  const page = await repo.listServiceRequests(input);
  return {
    items: page.rows.map(toServiceRequestRecord),
    nextCursor: page.nextCursor,
  };
}

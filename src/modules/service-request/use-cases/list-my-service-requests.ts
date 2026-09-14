import type { AuthenticatedUser } from "@/src/modules/auth/types";
import * as repo from "@/src/modules/service-request/repo";
import type { ListServiceRequestsInput } from "@/src/modules/service-request/schema";
import { toServiceRequestRecord } from "@/src/modules/service-request/use-cases/shared";

export async function listMyServiceRequests(
  actor: AuthenticatedUser,
  input: Pick<ListServiceRequestsInput, "cursor" | "limit">,
) {
  const page = await repo.listServiceRequests({ ...input, userId: actor.id });
  return {
    items: page.rows.map(toServiceRequestRecord),
    nextCursor: page.nextCursor,
  };
}

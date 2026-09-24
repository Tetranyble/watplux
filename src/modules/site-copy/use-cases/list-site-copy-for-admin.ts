import { db } from "@/lib/db";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_SITE_COPY_MANAGE } from "@/src/modules/site-copy/constants";

export async function listSiteCopyForAdmin(
  actor: AuthenticatedUser,
  namespace?: string,
) {
  requirePermission(actor, PERMISSION_SITE_COPY_MANAGE);
  return db.siteCopy.findMany({
    where: namespace ? { namespace } : undefined,
    orderBy: [{ namespace: "asc" }, { sortOrder: "asc" }, { key: "asc" }],
  });
}

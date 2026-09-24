import { db } from "@/lib/db";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_SITE_COPY_MANAGE } from "@/src/modules/site-copy/constants";
import type { UpdateSiteCopyInput } from "@/src/modules/site-copy/schema";

export async function updateSiteCopy(
  actor: AuthenticatedUser,
  input: UpdateSiteCopyInput,
) {
  requirePermission(actor, PERMISSION_SITE_COPY_MANAGE);

  return db.$transaction(async (tx) => {
    const keys = input.entries.map((entry) => entry.key);
    const existing = await tx.siteCopy.findMany({
      where: { key: { in: keys } },
    });
    if (existing.length !== keys.length) {
      throw new Error("One or more copy entries do not exist.");
    }

    const before = new Map(existing.map((entry) => [entry.key, entry.value]));
    await Promise.all(
      input.entries.map((entry) =>
        tx.siteCopy.update({
          where: { key: entry.key },
          data: { value: entry.value, updatedBy: actor.id },
        }),
      ),
    );

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "site_copy.updated",
        entityType: "site_copy",
        entityId: BigInt(0),
        beforeData: Object.fromEntries(before),
        afterData: Object.fromEntries(
          input.entries.map((entry) => [entry.key, entry.value]),
        ),
      },
    });

    return { updated: input.entries.length };
  });
}

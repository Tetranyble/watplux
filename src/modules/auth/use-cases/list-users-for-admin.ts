import { z } from "zod";

import * as authRepo from "@/src/modules/auth/repo";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  search: z.string().trim().max(255).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export async function listUsersForAdmin(
  actor: AuthenticatedUser,
  raw: z.input<typeof inputSchema>,
) {
  requirePermission(actor, "users.manage");
  const input = inputSchema.parse(raw);
  const result = await authRepo.listUsersForAdmin({
    limit: input.limit,
    cursorId: input.cursor ? BigInt(input.cursor) : undefined,
    search: input.search || undefined,
    status: input.status,
  });
  return {
    items: result.rows.map((row) => ({ ...row, id: row.id.toString() })),
    nextCursor: result.nextCursorId?.toString() ?? null,
  };
}

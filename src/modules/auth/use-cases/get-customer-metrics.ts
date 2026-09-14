import * as authRepo from "@/src/modules/auth/repo";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import type { CustomerMetrics } from "@/src/modules/auth/repo";

export type { CustomerMetrics };

const MANAGE_USERS_PERMISSION = "users.manage";

/** Admin dashboard read (docs/PHASE_10_ADMIN_PLAN.md §9) — `users.manage`,
 * the same permission `getUserProfile`'s admin path and `assignRole`/
 * `removeRole` already require. */
export async function getCustomerMetrics(
  actor: AuthenticatedUser,
  newCustomersSince: Date,
): Promise<CustomerMetrics> {
  requirePermission(actor, MANAGE_USERS_PERMISSION);
  return authRepo.getCustomerMetrics(newCustomersSince);
}

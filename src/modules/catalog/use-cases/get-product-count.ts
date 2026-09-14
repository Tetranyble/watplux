import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_READ } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";

/** Admin dashboard read (docs/PHASE_10_ADMIN_PLAN.md §9) — `products.read`. */
export async function getProductCount(
  actor: AuthenticatedUser,
): Promise<number> {
  requirePermission(actor, PERMISSION_PRODUCTS_READ);
  return catalogRepo.countActiveProducts();
}

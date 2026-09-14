import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_READ } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogCategory } from "@/src/modules/catalog/types";
import type { CategoryTreeNode } from "@/src/modules/catalog/types";

/**
 * Admin-facing category tree — `products.read`, includes inactive
 * categories (`publicOnly=false`). `catalogRepo.listAllCategories`
 * already accepted this flag; the public `getCategoryTree()` use-case
 * simply never called it with `false`. This is the Phase 10 additive
 * extension documented in docs/PHASE_10_ADMIN_PLAN.md §10/§28.4 — no new
 * repo logic, just wiring an existing capability through a
 * permission-gated use-case. The tree-building loop is intentionally a
 * small, separate copy of `getCategoryTree()`'s own logic rather than a
 * shared helper — the same small-duplication precedent this module
 * already established elsewhere (`idParamSchema` in every module's own
 * schema.ts).
 */
export async function getCategoryTreeForAdmin(
  actor: AuthenticatedUser,
): Promise<CategoryTreeNode[]> {
  requirePermission(actor, PERMISSION_PRODUCTS_READ);

  const flatCategories = await catalogRepo.listAllCategories(false);

  const nodesById = new Map<string, CategoryTreeNode>();
  for (const category of flatCategories) {
    nodesById.set(category.id.toString(), {
      ...toCatalogCategory(category),
      children: [],
    });
  }

  const roots: CategoryTreeNode[] = [];
  for (const category of flatCategories) {
    const node = nodesById.get(category.id.toString());
    if (!node) continue;

    const parentNode = category.parentId
      ? nodesById.get(category.parentId.toString())
      : undefined;

    if (parentNode) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogCategory } from "@/src/modules/catalog/types";
import type { CategoryTreeNode } from "@/src/modules/catalog/types";

/** Public/customer read — no authentication, `isActive` only
 * (docs/PHASE_4_CATALOG_PLAN.md §9). Builds the nested tree from a flat,
 * already-sorted `(parentId, sortOrder)` query — one round trip, not one
 * query per level. A customer browsing a still-active child of a
 * deactivated parent is an accepted, explicit admin choice (§5), not a
 * bug this function tries to hide by cascading the filter itself. */
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const flatCategories = await catalogRepo.listAllCategories(true);

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
      // Either a true root category, or its parent is inactive and thus
      // absent from `flatCategories` — either way, this node surfaces at
      // the top level rather than disappearing silently.
      roots.push(node);
    }
  }

  return roots;
}

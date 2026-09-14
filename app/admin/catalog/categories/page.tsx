import type { Metadata } from "next";

import { CategoryManager } from "@/components/admin/category-manager";
import { CatalogSubNav } from "@/components/admin/catalog-sub-nav";
import { getSessionUser } from "@/lib/session";
import {
  PERMISSION_PRODUCTS_CREATE,
  PERMISSION_PRODUCTS_UPDATE,
} from "@/src/modules/catalog/constants";
import { getCategoryTreeForAdmin } from "@/src/modules/catalog/use-cases/get-category-tree-for-admin";

export const metadata: Metadata = { title: "Categories" };

export const instant = false;

/**
 * `products.read`, enforced inside `getCategoryTreeForAdmin` itself —
 * the Phase 10 additive admin extension surfacing inactive categories
 * too (docs/PHASE_10_ADMIN_PLAN.md §10/§28.4).
 */
export default async function AdminCategoriesPage() {
  const actor = await getSessionUser();
  if (!actor) return null;

  const tree = await getCategoryTreeForAdmin(actor);
  const canCreate = actor.permissions.has(PERMISSION_PRODUCTS_CREATE);
  const canUpdate = actor.permissions.has(PERMISSION_PRODUCTS_UPDATE);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <CatalogSubNav active="/admin/catalog/categories" />
      <h1 className="text-2xl font-semibold">Categories</h1>
      <CategoryManager
        tree={tree}
        canCreate={canCreate}
        canUpdate={canUpdate}
      />
    </div>
  );
}

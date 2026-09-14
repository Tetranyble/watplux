import type { Metadata } from "next";

import { BrandManager } from "@/components/admin/brand-manager";
import { CatalogSubNav } from "@/components/admin/catalog-sub-nav";
import { getSessionUser } from "@/lib/session";
import {
  PERMISSION_PRODUCTS_CREATE,
  PERMISSION_PRODUCTS_UPDATE,
} from "@/src/modules/catalog/constants";
import { listBrandsForAdmin } from "@/src/modules/catalog/use-cases/list-brands-for-admin";

export const metadata: Metadata = { title: "Brands" };

export const instant = false;

/**
 * `products.read`, enforced inside `listBrandsForAdmin` itself — the
 * Phase 10 additive admin extension surfacing inactive brands too
 * (docs/PHASE_10_ADMIN_PLAN.md §10/§28.4).
 */
export default async function AdminBrandsPage() {
  const actor = await getSessionUser();
  if (!actor) return null;

  const brands = await listBrandsForAdmin(actor);
  const canCreate = actor.permissions.has(PERMISSION_PRODUCTS_CREATE);
  const canUpdate = actor.permissions.has(PERMISSION_PRODUCTS_UPDATE);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <CatalogSubNav active="/admin/catalog/brands" />
      <h1 className="text-2xl font-semibold">Brands</h1>
      <BrandManager
        brands={brands}
        canCreate={canCreate}
        canUpdate={canUpdate}
      />
    </div>
  );
}

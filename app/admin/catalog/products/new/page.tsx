import type { Metadata } from "next";

import { CatalogSubNav } from "@/components/admin/catalog-sub-nav";
import { ProductCreateForm } from "@/components/admin/product-create-form";
import { getSessionUser } from "@/lib/session";
import type { CategoryTreeNode } from "@/src/modules/catalog/types";
import { getCategoryTreeForAdmin } from "@/src/modules/catalog/use-cases/get-category-tree-for-admin";
import { listBrandsForAdmin } from "@/src/modules/catalog/use-cases/list-brands-for-admin";

export const metadata: Metadata = { title: "New product" };

export const instant = false;

/** Flattens the category tree into a depth-annotated list for a single
 * `<Select>` — mirrors `app/(storefront)/products/page.tsx`'s own
 * `flattenCategories` helper, duplicated here since that one is a
 * private helper of a different route, not an exported utility. */
function flattenWithDepth(
  nodes: CategoryTreeNode[],
  depth = 0,
): { id: string; name: string; depth: number }[] {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, depth },
    ...flattenWithDepth(node.children, depth + 1),
  ]);
}

/**
 * `products.create`, enforced inside `createProduct` itself once
 * submitted — the category/brand reads here use the Phase 10 additive
 * admin extensions (`getCategoryTreeForAdmin`/`listBrandsForAdmin`,
 * `products.read`-gated) so a draft product can be assigned to an
 * inactive category/brand if genuinely needed, not just active ones.
 */
export default async function NewProductPage() {
  const actor = await getSessionUser();
  if (!actor) return null;

  const [categoryTree, brands] = await Promise.all([
    getCategoryTreeForAdmin(actor),
    listBrandsForAdmin(actor),
  ]);
  const categories = flattenWithDepth(categoryTree);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <CatalogSubNav active="/admin/catalog/products" />
      <h1 className="text-2xl font-semibold">New product</h1>
      <ProductCreateForm categories={categories} brands={brands} />
    </div>
  );
}

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { CatalogSubNav } from "@/components/admin/catalog-sub-nav";
import { ImageManager } from "@/components/admin/image-manager";
import { ProductEditForm } from "@/components/admin/product-edit-form";
import { ProductLifecycleActions } from "@/components/admin/product-lifecycle-actions";
import { SpecificationManager } from "@/components/admin/specification-manager";
import { VariantManager } from "@/components/admin/variant-manager";
import { Badge } from "@/components/ui/badge";
import { isNotFoundError } from "@/lib/errors";
import { getSessionUser } from "@/lib/session";
import {
  PERMISSION_PRODUCTS_CREATE,
  PERMISSION_PRODUCTS_UPDATE,
} from "@/src/modules/catalog/constants";
import { idParamSchema } from "@/src/modules/catalog/schema";
import type { CategoryTreeNode } from "@/src/modules/catalog/types";
import { getCategoryTreeForAdmin } from "@/src/modules/catalog/use-cases/get-category-tree-for-admin";
import { getProductForAdmin } from "@/src/modules/catalog/use-cases/get-product-for-admin";
import { listBrandsForAdmin } from "@/src/modules/catalog/use-cases/list-brands-for-admin";

export const metadata: Metadata = { title: "Edit product" };

export const instant = false;

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
 * `products.read`, enforced inside `getProductForAdmin` itself
 * (docs/PHASE_10_ADMIN_PLAN.md §10). Orchestrates every catalog
 * sub-resource manager (variants/images/specifications) against the one
 * `ProductDetail` read — no separate per-section fetch, matching
 * `getProductForAdmin`'s own "the full graph in one call" shape.
 */
export default async function AdminProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) return null;

  const { productId } = await params;
  const parsedProductId = idParamSchema.safeParse(productId);
  if (!parsedProductId.success) {
    notFound();
  }

  let product;
  try {
    product = await getProductForAdmin(actor, parsedProductId.data);
  } catch (error) {
    if (isNotFoundError(error)) {
      notFound();
    }
    throw error;
  }

  const [categoryTree, brands] = await Promise.all([
    getCategoryTreeForAdmin(actor),
    listBrandsForAdmin(actor),
  ]);
  const categories = flattenWithDepth(categoryTree);

  const canCreate = actor.permissions.has(PERMISSION_PRODUCTS_CREATE);
  const canUpdate = actor.permissions.has(PERMISSION_PRODUCTS_UPDATE);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-8">
      <CatalogSubNav active="/admin/catalog/products" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          <Badge
            variant={
              product.status === "ACTIVE"
                ? "default"
                : product.status === "DRAFT"
                  ? "outline"
                  : "secondary"
            }
          >
            {product.status}
          </Badge>
          {product.deletedAt ? (
            <Badge variant="destructive">Deleted</Badge>
          ) : null}
        </div>
        {canUpdate ? <ProductLifecycleActions product={product} /> : null}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Details
        </h2>
        {canUpdate ? (
          <ProductEditForm
            product={product}
            categories={categories}
            brands={brands}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            You do not have permission to edit this product.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Variants
        </h2>
        <VariantManager
          productId={product.id}
          variants={product.variants}
          canCreate={canCreate}
          canUpdate={canUpdate}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Images
        </h2>
        <ImageManager
          productId={product.id}
          images={product.images}
          canCreate={canCreate}
          canUpdate={canUpdate}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Specifications
        </h2>
        <SpecificationManager
          productId={product.id}
          specifications={product.specifications}
          canUpdate={canUpdate}
        />
      </section>
    </div>
  );
}

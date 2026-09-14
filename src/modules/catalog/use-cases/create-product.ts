import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_CREATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductDetail } from "@/src/modules/catalog/types";
import type { CreateProductInput } from "@/src/modules/catalog/schema";
import type { ProductDetail } from "@/src/modules/catalog/types";

/**
 * Always creates the product `DRAFT` with its first (default) variant in
 * one transaction — the "at least one variant, exactly one default" half
 * of the invariant (docs/PHASE_4_CATALOG_PLAN.md §4). A product is never
 * created directly `ACTIVE`; publishing is a separate, explicit act
 * (`publishProduct`).
 *
 * `actor` is the already-resolved caller (docs/PHASE_4_CATALOG_PLAN.md §12
 * — matching `src/modules/auth/use-cases/assign-role.ts`'s convention):
 * the Route Handler/Server Action resolves it via
 * `requireSessionUser()`/`getSessionUser()` from `lib/session.ts` and
 * passes it in. Use-cases never import `next/headers` and never re-derive
 * identity from a raw token themselves.
 */
export async function createProduct(
  actor: AuthenticatedUser,
  input: CreateProductInput,
): Promise<ProductDetail> {
  requirePermission(actor, PERMISSION_PRODUCTS_CREATE);

  const created = await catalogRepo.createProductWithFirstVariant({
    name: input.name,
    slug: input.slug,
    shortDescription: input.shortDescription,
    description: input.description,
    unitOfMeasure: input.unitOfMeasure,
    categoryId: input.categoryId,
    brandId: input.brandId,
    warrantyMonths: input.warrantyMonths,
    isFeatured: input.isFeatured,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    variant: input.variant,
  });

  const product = await catalogRepo.findProductById(created.id);
  if (!product) {
    throw new Error("Product disappeared immediately after creation.");
  }
  return toProductDetail(product);
}

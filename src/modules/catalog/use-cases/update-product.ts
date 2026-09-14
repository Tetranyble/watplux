import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { NotFoundError } from "@/lib/errors";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toProductDetail } from "@/src/modules/catalog/types";
import type { UpdateProductInput } from "@/src/modules/catalog/schema";
import type { ProductDetail } from "@/src/modules/catalog/types";

export async function updateProduct(
  actor: AuthenticatedUser,
  productId: bigint,
  input: UpdateProductInput,
): Promise<ProductDetail> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const existing = await catalogRepo.findProductById(productId);
  if (!existing) throw new NotFoundError("Product not found.");

  await catalogRepo.updateProduct(productId, {
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
  });

  const product = await catalogRepo.findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  return toProductDetail(product);
}

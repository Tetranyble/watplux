import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogSpecification } from "@/src/modules/catalog/types";
import type { UpsertProductSpecificationInput } from "@/src/modules/catalog/schema";
import type { CatalogSpecification } from "@/src/modules/catalog/types";

/**
 * True upsert on `(productId, specKey)` — `specKey` arrives already
 * normalized by the Zod schema's transform (§8), so this never creates a
 * near-duplicate key. Requires `products.update`, not a separate
 * create/update split — specifications don't distinguish the two the way
 * products/variants/images do.
 */
export async function upsertProductSpecification(
  actor: AuthenticatedUser,
  input: UpsertProductSpecificationInput,
): Promise<CatalogSpecification> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const product = await catalogRepo.findProductById(input.productId);
  if (!product) throw new NotFoundError("Product not found.");

  const spec = await catalogRepo.upsertProductSpecification({
    productId: input.productId,
    specKey: input.specKey,
    specValue: input.specValue,
    unit: input.unit,
    groupLabel: input.groupLabel,
    sortOrder: input.sortOrder,
  });

  return toCatalogSpecification(spec);
}

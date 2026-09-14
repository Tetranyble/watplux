import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogBrand } from "@/src/modules/catalog/types";
import type { UpdateBrandInput } from "@/src/modules/catalog/schema";
import type { CatalogBrand } from "@/src/modules/catalog/types";

export async function updateBrand(
  actor: AuthenticatedUser,
  brandId: bigint,
  input: UpdateBrandInput,
): Promise<CatalogBrand> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const existing = await catalogRepo.findBrandById(brandId);
  if (!existing) throw new NotFoundError("Brand not found.");

  const updated = await catalogRepo.updateBrand(brandId, {
    name: input.name,
    slug: input.slug,
    logoUrl: input.logoUrl,
    description: input.description,
  });

  return toCatalogBrand(updated);
}

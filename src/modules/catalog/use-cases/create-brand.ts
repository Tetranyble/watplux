import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_CREATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogBrand } from "@/src/modules/catalog/types";
import type { CreateBrandInput } from "@/src/modules/catalog/schema";
import type { CatalogBrand } from "@/src/modules/catalog/types";

export async function createBrand(
  actor: AuthenticatedUser,
  input: CreateBrandInput,
): Promise<CatalogBrand> {
  requirePermission(actor, PERMISSION_PRODUCTS_CREATE);

  const brand = await catalogRepo.createBrand({
    name: input.name,
    slug: input.slug,
    logoUrl: input.logoUrl,
    description: input.description,
  });

  return toCatalogBrand(brand);
}

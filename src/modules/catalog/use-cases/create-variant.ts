import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_CREATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogVariant } from "@/src/modules/catalog/types";
import type { CreateVariantInput } from "@/src/modules/catalog/schema";
import type { CatalogVariant } from "@/src/modules/catalog/types";

/** Always `isDefault: false` — never a side door for changing the
 * default (docs/PHASE_4_CATALOG_PLAN.md §4). Changing the default is
 * exclusively `setDefaultVariant`. No product-row lock needed at the
 * repo layer — this can only ever add to the `ACTIVE` set (§13a). */
export async function createVariant(
  actor: AuthenticatedUser,
  input: CreateVariantInput,
): Promise<CatalogVariant> {
  requirePermission(actor, PERMISSION_PRODUCTS_CREATE);

  const product = await catalogRepo.findProductById(input.productId);
  if (!product) throw new NotFoundError("Product not found.");

  const variant = await catalogRepo.createVariant({
    productId: input.productId,
    sku: input.sku,
    variantLabel: input.variantLabel,
    optionValues: input.optionValues,
    priceMinor: input.priceMinor,
    compareAtPriceMinor: input.compareAtPriceMinor,
    sortOrder: input.sortOrder,
    powerRatingW: input.powerRatingW,
    voltageV: input.voltageV,
    capacityWh: input.capacityWh,
    ratedCurrentA: input.ratedCurrentA,
    phase: input.phase,
    efficiencyPercent: input.efficiencyPercent,
    mpptMinV: input.mpptMinV,
    mpptMaxV: input.mpptMaxV,
    weightKg: input.weightKg,
    lengthCm: input.lengthCm,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
  });

  return toCatalogVariant(variant);
}

import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import { toCatalogVariant } from "@/src/modules/catalog/types";
import type { UpdateVariantInput } from "@/src/modules/catalog/schema";
import type { CatalogVariant } from "@/src/modules/catalog/types";

/** Never settable here: `isDefault`/`status` — those go through
 * `setDefaultVariant`/`archiveVariant`/`reactivateVariant`
 * (docs/PHASE_4_CATALOG_PLAN.md §4). */
export async function updateVariant(
  actor: AuthenticatedUser,
  variantId: bigint,
  input: UpdateVariantInput,
): Promise<CatalogVariant> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  const existing = await catalogRepo.findVariantById(variantId);
  if (!existing) throw new NotFoundError("Variant not found.");

  const updated = await catalogRepo.updateVariant(variantId, {
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

  return toCatalogVariant(updated);
}

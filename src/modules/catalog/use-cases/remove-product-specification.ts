import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_UPDATE } from "@/src/modules/catalog/constants";
import * as catalogRepo from "@/src/modules/catalog/repo";
import type { RemoveProductSpecificationInput } from "@/src/modules/catalog/schema";

export async function removeProductSpecification(
  actor: AuthenticatedUser,
  input: RemoveProductSpecificationInput,
): Promise<void> {
  requirePermission(actor, PERMISSION_PRODUCTS_UPDATE);

  await catalogRepo.removeProductSpecification(input.productId, input.specKey);
}

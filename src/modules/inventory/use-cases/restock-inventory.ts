import { Prisma } from "@prisma/client";

import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_INVENTORY_ADJUST } from "@/src/modules/inventory/constants";
import * as inventoryRepo from "@/src/modules/inventory/repo";
import { toInventoryMovementRecord } from "@/src/modules/inventory/types";
import type { RestockInventoryInput } from "@/src/modules/inventory/schema";
import type { InventoryMovementRecord } from "@/src/modules/inventory/types";

/**
 * Creates the `InventoryItem` row if it doesn't exist yet (first-ever
 * stock for a variant); otherwise a blind guarded increment
 * (docs/PHASE_5_INVENTORY_PLAN.md §11). `repo.ts` writes the `RESTOCK`
 * movement and a mirrored `audit_logs` entry together, in the same
 * transaction — the two-independent-trails pattern
 * `docs/DATABASE_DESIGN.md` §5 invariant 9 specifies for `ADJUSTMENT`,
 * extended here.
 */
export async function restockInventory(
  actor: AuthenticatedUser,
  variantId: bigint,
  input: RestockInventoryInput,
): Promise<InventoryMovementRecord> {
  requirePermission(actor, PERMISSION_INVENTORY_ADJUST);

  const movement = await inventoryRepo.restockInventory({
    variantId,
    quantity: new Prisma.Decimal(input.quantity),
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    note: input.note,
    createdBy: actor.id,
  });

  return toInventoryMovementRecord(movement);
}

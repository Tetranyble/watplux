import { Prisma } from "@prisma/client";

import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_INVENTORY_ADJUST } from "@/src/modules/inventory/constants";
import * as inventoryRepo from "@/src/modules/inventory/repo";
import { toInventoryMovementRecord } from "@/src/modules/inventory/types";
import type { RecordInventoryReturnInput } from "@/src/modules/inventory/schema";
import type { InventoryMovementRecord } from "@/src/modules/inventory/types";

/** No exactly-once constraint — multiple partial returns against the
 * same variant/order line are legitimate (docs/PHASE_5_INVENTORY_PLAN.md
 * §3). Gated by `inventory.adjust`, same sensitivity class as
 * `RESTOCK`/`ADJUSTMENT` (§10). */
export async function recordInventoryReturn(
  actor: AuthenticatedUser,
  variantId: bigint,
  input: RecordInventoryReturnInput,
): Promise<InventoryMovementRecord> {
  requirePermission(actor, PERMISSION_INVENTORY_ADJUST);

  const movement = await inventoryRepo.recordInventoryReturn({
    variantId,
    quantity: new Prisma.Decimal(input.quantity),
    orderItemId: input.orderItemId,
    note: input.note,
    createdBy: actor.id,
  });

  return toInventoryMovementRecord(movement);
}

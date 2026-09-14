import { Prisma } from "@prisma/client";

import { ValidationError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_INVENTORY_ADJUST } from "@/src/modules/inventory/constants";
import * as inventoryRepo from "@/src/modules/inventory/repo";
import { toInventoryMovementRecord } from "@/src/modules/inventory/types";
import type { AdjustInventoryInput } from "@/src/modules/inventory/schema";
import type { InventoryMovementRecord } from "@/src/modules/inventory/types";

/**
 * Exactly one of `delta`/`newQuantity` is present (Zod-enforced,
 * `schema.ts`). `delta` takes the blind guarded relative-update path
 * (docs/PHASE_5_INVENTORY_PLAN.md §7); `newQuantity` takes the
 * `SELECT ... FOR UPDATE` absolute-target path (§7/§12) — the one
 * inventory operation in this domain needing an explicit lock. `note` is
 * mandatory (Zod-enforced) — `docs/DATABASE_DESIGN.md` §5 invariant 9.
 */
export async function adjustInventory(
  actor: AuthenticatedUser,
  variantId: bigint,
  input: AdjustInventoryInput,
): Promise<InventoryMovementRecord> {
  requirePermission(actor, PERMISSION_INVENTORY_ADJUST);

  let movement;
  if (input.delta !== undefined) {
    movement = await inventoryRepo.adjustInventoryByDelta({
      variantId,
      delta: new Prisma.Decimal(input.delta),
      note: input.note,
      createdBy: actor.id,
    });
  } else if (input.newQuantity !== undefined) {
    movement = await inventoryRepo.adjustInventoryToTarget({
      variantId,
      newQuantity: new Prisma.Decimal(input.newQuantity),
      note: input.note,
      createdBy: actor.id,
    });
  } else {
    // Unreachable given the schema's superRefine (exactly one of
    // delta/newQuantity is always present) — a defensive fallback rather
    // than a silent `undefined` reaching the repo layer.
    throw new ValidationError("Supply exactly one of delta or newQuantity.");
  }

  return toInventoryMovementRecord(movement);
}

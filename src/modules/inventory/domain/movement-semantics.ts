import { Prisma } from "@prisma/client";

/**
 * Pure per-movement-type delta semantics — zero I/O
 * (docs/PHASE_5_INVENTORY_PLAN.md §3's table, expressed as data). Used by
 * `schema.ts` and by use-cases/tests to verify a movement's effect on
 * `on_hand_delta`/`reserved_delta` — never called by `repo.ts` directly.
 * `repo.ts`'s per-type write functions each hardcode their own sign
 * pattern inline (the same small, deliberate duplication Phase 4 accepted
 * for its own tiny pure helpers, e.g. `pickReplacementDefault`'s logic
 * being independently verified by a dedicated unit test rather than
 * imported across the `repo.ts` boundary) — this function exists as the
 * single, independently-tested source of truth those hardcoded functions
 * must agree with, not as a runtime dependency of `repo.ts`.
 *
 * Only the five *magnitude-based* types are covered here — each takes a
 * positive quantity and this function determines the sign.
 * `ADJUSTMENT`'s delta is supplied directly, already signed, by the
 * caller (docs/PHASE_5_INVENTORY_PLAN.md §12) and has no "sign to look
 * up," so it is deliberately not part of this table.
 */

export type MagnitudeBasedMovementType =
  "RESTOCK" | "RESERVE" | "RELEASE" | "SALE" | "RETURN";

interface DeltaSigns {
  onHandSign: 1 | 0 | -1;
  reservedSign: 1 | 0 | -1;
}

const DELTA_SIGNS: Record<MagnitudeBasedMovementType, DeltaSigns> = {
  RESTOCK: { onHandSign: 1, reservedSign: 0 },
  RESERVE: { onHandSign: 0, reservedSign: 1 },
  RELEASE: { onHandSign: 0, reservedSign: -1 },
  SALE: { onHandSign: -1, reservedSign: -1 },
  RETURN: { onHandSign: 1, reservedSign: 0 },
};

export interface MovementDeltas {
  onHandDelta: Prisma.Decimal;
  reservedDelta: Prisma.Decimal;
}

/** `quantity` must be a positive magnitude (never itself signed) — the
 * sign is entirely determined by `type`, per docs/PHASE_5_INVENTORY_PLAN.md
 * §3's table. */
export function deltasForMovementType(
  type: MagnitudeBasedMovementType,
  quantity: Prisma.Decimal,
): MovementDeltas {
  const signs = DELTA_SIGNS[type];
  return {
    onHandDelta: quantity.times(signs.onHandSign),
    reservedDelta: quantity.times(signs.reservedSign),
  };
}

import { z } from "zod";

import {
  hasValidQuantityPrecision,
  isFiniteQuantity,
  isPositiveQuantity,
} from "@/src/modules/inventory/quantity";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/src/modules/inventory/constants";

/**
 * Single source of truth for inventory input shapes
 * (docs/PHASE_5_INVENTORY_PLAN.md §9) — every use-case's public input
 * goes through one of these before the use-case body runs, matching
 * `src/modules/catalog/schema.ts`'s convention.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Not imported from `src/modules/catalog/schema.ts` — a deliberate,
 * small duplication keeping the two modules independent, the same
 * precedent Phase 4 already established for its own tiny pure helpers. */
export const idParamSchema = z.coerce.bigint().positive();

/** A positive quantity, at most 3 decimal places
 * (docs/DATABASE_DESIGN.md §19 — `DECIMAL(12,3)`). Used for every
 * quantity a caller supplies as a magnitude to move (restock, reserve,
 * release, sale, return) — never for an `ADJUSTMENT` delta, which may be
 * negative (see `adjustmentDeltaSchema` below). */
const positiveQuantitySchema = z
  .number()
  .refine(isFiniteQuantity, { message: "Quantity must be a finite number." })
  .refine(isPositiveQuantity, {
    message: "Quantity must be greater than zero.",
  })
  .refine(hasValidQuantityPrecision, {
    message: "Quantity may have at most 3 decimal places.",
  });

/** A signed adjustment delta — may be negative, must not be zero (a
 * zero-delta adjustment changes nothing and is rejected as a likely
 * client error), at most 3 decimal places. */
const adjustmentDeltaSchema = z
  .number()
  .refine(isFiniteQuantity, { message: "Delta must be a finite number." })
  .refine((value) => value !== 0, { message: "Delta must not be zero." })
  .refine(hasValidQuantityPrecision, {
    message: "Delta may have at most 3 decimal places.",
  });

/** An absolute target quantity for the absolute-target adjustment path
 * (docs/PHASE_5_INVENTORY_PLAN.md §7/§12) — non-negative (a target stock
 * count of exactly zero is valid; negative is not), at most 3 decimal
 * places. */
const absoluteQuantitySchema = z
  .number()
  .refine(isFiniteQuantity, { message: "Quantity must be a finite number." })
  .refine((value) => value >= 0, {
    message: "Quantity must not be negative.",
  })
  .refine(hasValidQuantityPrecision, {
    message: "Quantity may have at most 3 decimal places.",
  });

const noteSchema = z.string().trim().min(1).max(2000);

export const cursorPaginationSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const listInventorySchema = cursorPaginationSchema.extend({
  lowStockOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type ListInventoryInput = z.infer<typeof listInventorySchema>;

export const movementHistorySchema = cursorPaginationSchema;
export type MovementHistoryInput = z.infer<typeof movementHistorySchema>;

// ---------------------------------------------------------------------------
// Mutations — RESTOCK / ADJUSTMENT / RETURN
// ---------------------------------------------------------------------------

export const restockInventorySchema = z.object({
  quantity: positiveQuantitySchema,
  referenceType: z.enum(["MANUAL", "PURCHASE_ORDER"]).optional(),
  referenceId: idParamSchema.optional(),
  note: z.string().trim().min(1).max(2000).optional(),
});
export type RestockInventoryInput = z.infer<typeof restockInventorySchema>;

/** Exactly one of `delta`/`newQuantity` — Zod-enforced mutual exclusivity
 * (docs/PHASE_5_INVENTORY_PLAN.md §12). `note` is mandatory, unlike every
 * other mutation in this module — invariant 9,
 * docs/DATABASE_DESIGN.md §5. */
export const adjustInventorySchema = z
  .object({
    delta: adjustmentDeltaSchema.optional(),
    newQuantity: absoluteQuantitySchema.optional(),
    note: noteSchema,
  })
  .superRefine((value, ctx) => {
    const hasDelta = value.delta !== undefined;
    const hasNewQuantity = value.newQuantity !== undefined;
    if (hasDelta === hasNewQuantity) {
      ctx.addIssue({
        code: "custom",
        message:
          "Supply exactly one of delta or newQuantity, not both or neither.",
        path: hasDelta ? ["newQuantity"] : ["delta"],
      });
    }
  });
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;

export const recordInventoryReturnSchema = z.object({
  quantity: positiveQuantitySchema,
  orderItemId: idParamSchema.optional(),
  note: z.string().trim().min(1).max(2000).optional(),
});
export type RecordInventoryReturnInput = z.infer<
  typeof recordInventoryReturnSchema
>;

// ---------------------------------------------------------------------------
// Inter-module contract inputs (docs/PHASE_5_INVENTORY_PLAN.md §15) — no
// Route Handler exists for these; still Zod-validated at the use-case
// boundary, matching the auth/catalog convention that a script or job
// calling a use-case directly gets the same guarantees an HTTP caller
// does (the schema, not the use-case body, performs the check).
// ---------------------------------------------------------------------------

export const reserveInventorySchema = z.object({
  orderItemId: idParamSchema,
  variantId: idParamSchema,
  quantity: positiveQuantitySchema,
});
export type ReserveInventoryInput = z.infer<typeof reserveInventorySchema>;

export const releaseInventorySchema = z.object({
  orderItemId: idParamSchema,
});
export type ReleaseInventoryInput = z.infer<typeof releaseInventorySchema>;

export const completeInventorySaleSchema = z.object({
  orderItemId: idParamSchema,
});
export type CompleteInventorySaleInput = z.infer<
  typeof completeInventorySaleSchema
>;

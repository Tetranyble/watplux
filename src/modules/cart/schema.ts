import { z } from "zod";

import {
  hasValidQuantityPrecision,
  isFiniteQuantity,
  isPositiveQuantity,
} from "@/src/modules/cart/quantity";

/**
 * Single source of truth for cart/checkout input shapes
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §24/§25), matching
 * `src/modules/order/schema.ts`'s convention exactly. The client submits
 * only `variantId` + `quantity` for every cart mutation — never a price,
 * name, or SKU (plan §7).
 */

/** Not imported from `src/modules/order/schema.ts` — the same deliberate
 * small duplication Phase 4/5/6 already established. */
export const idParamSchema = z.coerce.bigint().positive();

const positiveQuantitySchema = z
  .number()
  .refine(isFiniteQuantity, { message: "Quantity must be a finite number." })
  .refine(isPositiveQuantity, {
    message: "Quantity must be greater than zero.",
  })
  .refine(hasValidQuantityPrecision, {
    message: "Quantity may have at most 3 decimal places.",
  });

export const addCartItemSchema = z.object({
  variantId: idParamSchema,
  quantity: positiveQuantitySchema,
});
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemQuantitySchema = z.object({
  quantity: positiveQuantitySchema,
});
export type UpdateCartItemQuantityInput = z.infer<
  typeof updateCartItemQuantitySchema
>;

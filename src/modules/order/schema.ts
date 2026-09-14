import { z } from "zod";

import {
  hasValidQuantityPrecision,
  isFiniteQuantity,
  isPositiveQuantity,
} from "@/src/modules/order/quantity";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/src/modules/order/constants";

/**
 * Single source of truth for order input shapes
 * (docs/PHASE_6_ORDER_PLAN.md §19), matching
 * `src/modules/inventory/schema.ts`'s convention exactly.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Not imported from `src/modules/inventory/schema.ts` — the same
 * deliberate small duplication Phase 4/5 already established. */
export const idParamSchema = z.coerce.bigint().positive();

export const orderNumberParamSchema = z.string().trim().min(1).max(30);

const positiveQuantitySchema = z
  .number()
  .refine(isFiniteQuantity, { message: "Quantity must be a finite number." })
  .refine(isPositiveQuantity, {
    message: "Quantity must be greater than zero.",
  })
  .refine(hasValidQuantityPrecision, {
    message: "Quantity may have at most 3 decimal places.",
  });

export const cursorPaginationSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

/** Matches `order_addresses`' exact snapshot shape — country is
 * `@db.Char(2)` (ISO alpha-2), defaulting to "NG" like the column itself. */
const addressInputSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(1).max(32),
  addressLine1: z.string().trim().min(1).max(255),
  addressLine2: z.string().trim().max(255).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  country: z.string().trim().length(2).default("NG"),
  postalCode: z.string().trim().max(20).optional(),
  deliveryNotes: z.string().trim().max(2000).optional(),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

const orderLineInputSchema = z.object({
  variantId: idParamSchema,
  quantity: positiveQuantitySchema,
});
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * `guestEmail`/`guestPhone` are structurally optional here — whether they
 * are actually required depends on whether the caller is authenticated
 * (an actor) or not (a guest checkout), which this schema cannot see; the
 * use-case enforces that business rule (docs/PHASE_6_ORDER_PLAN.md §1's
 * "guest checkout is a first-class, already-designed case").
 * `billingAddress` is optional — if omitted, no `order_addresses` billing
 * row is created at all (a "same as shipping" checkout simply sends only
 * a shipping address).
 */
export const createOrderSchema = z.object({
  lines: z
    .array(orderLineInputSchema)
    .min(1, "At least one line item is required."),
  shippingAddress: addressInputSchema,
  billingAddress: addressInputSchema.optional(),
  customerNote: z.string().trim().max(2000).optional(),
  guestEmail: z.string().trim().email().max(255).optional(),
  guestPhone: z.string().trim().max(32).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const cancelOrderSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const listMyOrdersSchema = cursorPaginationSchema;
export type ListMyOrdersInput = z.infer<typeof listMyOrdersSchema>;

const orderStatusEnum = z.enum([
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "READY_FOR_DISPATCH",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);

export const listOrdersForAdminSchema = cursorPaginationSchema
  .extend({
    status: orderStatusEnum.optional(),
    // --- Phase 10 additive extensions (docs/PHASE_10_ADMIN_PLAN.md §12/§28.5) ---
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    orderNumber: z.string().trim().min(1).max(30).optional(),
    customerEmail: z.string().trim().min(1).max(255).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      ctx.addIssue({
        code: "custom",
        message: "dateFrom must be less than or equal to dateTo.",
        path: ["dateFrom"],
      });
    }
  });
export type ListOrdersForAdminInput = z.infer<typeof listOrdersForAdminSchema>;

// ---------------------------------------------------------------------------
// Inter-module contract input (docs/PHASE_6_ORDER_PLAN.md §8) — no Route
// Handler exists for this; still Zod-validated at the use-case boundary,
// matching Inventory's convention that a script or job calling a use-case
// directly gets the same guarantees an HTTP caller does.
// ---------------------------------------------------------------------------

export const markOrderPaidSchema = z.object({
  orderId: idParamSchema,
  paymentAttemptId: idParamSchema,
});
export type MarkOrderPaidInput = z.infer<typeof markOrderPaidSchema>;

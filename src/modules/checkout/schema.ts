import { z } from "zod";

/**
 * Single source of truth for Checkout input shapes
 * (docs/PHASE_7_CART_CHECKOUT_PLAN.md §25) — reuses Order's exact
 * `AddressInput` shape, not imported from `order/schema.ts` (the same
 * deliberate small duplication Phase 4-6 already established), to avoid
 * two independently-drifting address schemas for what must end up as the
 * identical `order_addresses` snapshot.
 */
export const addressInputSchema = z.object({
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

export const completeCheckoutSchema = z.object({
  shippingAddress: addressInputSchema,
  billingAddress: addressInputSchema.optional(),
  customerNote: z.string().trim().max(2000).optional(),
  guestEmail: z.string().trim().email().max(255).optional(),
  guestPhone: z.string().trim().max(32).optional(),
});
export type CompleteCheckoutInput = z.infer<typeof completeCheckoutSchema>;

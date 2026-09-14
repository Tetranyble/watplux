import { z } from "zod";

/**
 * Single source of truth for payment/refund input shapes
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §22), matching
 * `src/modules/order/schema.ts`'s convention exactly.
 */

/** Not imported from another module's schema.ts — the same deliberate
 * small duplication Phase 4-7 already established. */
export const idParamSchema = z.coerce.bigint().positive();

// `guestToken` is additive (docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A)
// — every existing authenticated caller still sends `{}` and validates
// identically; the route layer alone decides what an included token means.
export const retryPaymentSchema = z.object({
  guestToken: z.string().trim().min(1).optional(),
});
export type RetryPaymentInput = z.infer<typeof retryPaymentSchema>;

/**
 * `amountMinor` is optional — omitted means "refund the full available
 * refundable amount" (plan §19's Allocate step defaults to the attempt's
 * own remaining balance when no explicit amount is given). Never larger
 * than what the allocation guard itself will accept — the guard, not
 * this schema, is the authoritative check (plan §19/§20).
 */
export const requestRefundSchema = z.object({
  amountMinor: z.number().int().positive().optional(),
  reason: z.string().trim().max(2000).optional(),
});
export type RequestRefundInput = z.infer<typeof requestRefundSchema>;

export const cancelRefundSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelRefundInput = z.infer<typeof cancelRefundSchema>;

// ---------------------------------------------------------------------------
// Admin-wide refund queue (Phase 10 additive extension —
// docs/PHASE_10_ADMIN_PLAN.md §14/§28.6/§31)
// ---------------------------------------------------------------------------

const refundStatusEnum = z.enum([
  "REFUND_REQUESTED",
  "REFUND_PENDING",
  "REFUNDED",
  "REFUND_FAILED",
  "REFUND_CANCELLED",
]);

export const listRefundsForAdminSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: refundStatusEnum.optional(),
});
export type ListRefundsForAdminInput = z.infer<
  typeof listRefundsForAdminSchema
>;

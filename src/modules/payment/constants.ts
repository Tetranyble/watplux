/** Already-seeded permissions (`prisma/seed-data.ts`) — no new permission
 * keys are introduced by this module (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md
 * §22). */
export const PERMISSION_PAYMENTS_READ = "payments.read";
export const PERMISSION_PAYMENTS_REFUND = "payments.refund";

/** `payment_attempts.currency`/`orders.currency` default — unchanged from
 * Phase 6/7. */
export const DEFAULT_CURRENCY = "NGN";

/** Guest payment-result access token lifetime (docs/PHASE_9_STOREFRONT_PLAN.md
 * §13.4 Option A) — long enough to cover a guest returning from Paystack
 * after a delay or checking again later the same day, bounded so a
 * link/URL leaked (e.g. via a shared screenshot) doesn't stay valid
 * indefinitely. */
export const GUEST_ORDER_TOKEN_TTL_SECONDS = 60 * 60 * 24;

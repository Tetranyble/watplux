import { db } from "@/lib/db";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { ownerForUser } from "./cart-fixtures";
import { addCartItem } from "@/src/modules/cart/use-cases/add-cart-item";
import { completeCheckout } from "@/src/modules/checkout/use-cases/complete-checkout";
import type { CompleteCheckoutOutcome } from "@/src/modules/checkout/use-cases/complete-checkout";
import type { PaystackClient } from "@/src/modules/payment/types";
import { createFakePaystackClient } from "./fake-paystack-client";

export const DEFAULT_SHIPPING_ADDRESS = {
  fullName: "Payment Test Customer",
  phone: "+2348012345678",
  addressLine1: "1 Payment Street",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
};

/** Drives the real checkout flow (Phase 7, unchanged) through to a
 * PENDING payment attempt via a fake, deterministic Paystack client
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §28.4) — never a real network
 * call. */
export async function checkoutAndInitializePayment(
  actor: AuthenticatedUser,
  variantId: bigint,
  overrides: { quantity?: number; paystackClient?: PaystackClient } = {},
): Promise<CompleteCheckoutOutcome> {
  const owner = ownerForUser(actor);
  await addCartItem(owner, { variantId, quantity: overrides.quantity ?? 1 });
  return completeCheckout(
    owner,
    { shippingAddress: DEFAULT_SHIPPING_ADDRESS },
    actor.email,
    overrides.paystackClient ?? createFakePaystackClient(),
  );
}

/**
 * Deletes every payment-domain row this test run created, matched
 * transitively via the `Phase4Test` product-name prefix (the same
 * matching order-fixtures.ts's own `cleanupOrderTestData` uses) — MUST
 * run BEFORE `cleanupOrderTestData()`, since `refunds`/`webhook_events`
 * both have `ON DELETE RESTRICT` FKs into `payment_attempts`, which
 * `cleanupOrderTestData()` itself deletes.
 */
export async function cleanupPaymentTestData(): Promise<void> {
  const testOrders = await db.order.findMany({
    where: {
      items: { some: { product: { name: { startsWith: "Phase4Test" } } } },
    },
    select: { id: true },
  });
  const orderIds = testOrders.map((o) => o.id);

  if (orderIds.length > 0) {
    const attempts = await db.paymentAttempt.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, paystackReference: true },
    });
    const attemptIds = attempts.map((a) => a.id);
    const attemptReferences = attempts
      .map((a) => a.paystackReference)
      .filter((reference): reference is string => reference !== null);

    if (attemptIds.length > 0) {
      // Match by BOTH `resolvedPaymentAttemptId` and the attempt's own
      // `paystackReference` — a webhook inserted directly against a real
      // test attempt's reference (as webhook-processing.test.ts's
      // charge-event tests do) can still be sitting PENDING/FAILED with
      // no `resolvedPaymentAttemptId` set yet (the worker only populates
      // it once it resolves the event), so matching on the resolved id
      // alone leaves it as an orphaned row after cleanup.
      await db.webhookEvent.deleteMany({
        where: {
          OR: [
            { resolvedPaymentAttemptId: { in: attemptIds } },
            ...(attemptReferences.length > 0
              ? [{ paystackReference: { in: attemptReferences } }]
              : []),
          ],
        },
      });
      const refunds = await db.refund.findMany({
        where: { paymentAttemptId: { in: attemptIds } },
        select: { id: true },
      });
      const refundIds = refunds.map((r) => r.id);
      if (refundIds.length > 0) {
        await db.webhookEvent.deleteMany({
          where: { resolvedRefundId: { in: refundIds } },
        });
        await db.refund.deleteMany({ where: { id: { in: refundIds } } });
      }
    }
  }

  // Orphan webhook_events created directly by ingestion-only tests (no
  // resolved attempt/refund) — matched by a distinctive test-only
  // reference prefix, never a real attempt's reference.
  await db.webhookEvent.deleteMany({
    where: { paystackReference: { startsWith: "TESTWEBHOOK-" } },
  });
}

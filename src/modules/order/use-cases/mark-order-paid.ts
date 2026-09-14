import * as orderRepo from "@/src/modules/order/repo";
import { toOrderDetail } from "@/src/modules/order/types";
import type { MarkOrderPaidInput } from "@/src/modules/order/schema";
import type { MarkOrderPaidResult } from "@/src/modules/order/types";

/**
 * Inter-module contract (docs/PHASE_6_ORDER_PLAN.md §8) — no `actor`, no
 * permission check, no HTTP route, exactly mirroring Inventory's
 * `completeInventorySale({ orderItemId })` shape. Called by a future
 * Payment webhook worker only *after* it has independently verified a
 * payment attempt reached `SUCCESS` via Paystack — this use-case never
 * calls Paystack and never inspects a webhook payload itself.
 *
 * `repo.ts` verifies the payment attempt exists AND belongs to the exact
 * order being mutated AND is genuinely `SUCCESS` before any mutation
 * (`requireMatchingPaymentAttempt`) — the FK on
 * `orders.authoritative_payment_attempt_id` only proves the referenced
 * row exists, never that it names this order (plan §8).
 *
 * Never throws on "already PAID" or "already CANCELLED" — returns
 * `{ transitioned: false, order }` so the caller can distinguish a
 * genuine race/reconciliation case from a hard error (plan §11/§12).
 */
export async function markOrderPaid(
  input: MarkOrderPaidInput,
): Promise<MarkOrderPaidResult> {
  const result = await orderRepo.markOrderPaid({
    orderId: input.orderId,
    paymentAttemptId: input.paymentAttemptId,
  });

  return {
    transitioned: result.transitioned,
    order: toOrderDetail(result.order),
  };
}

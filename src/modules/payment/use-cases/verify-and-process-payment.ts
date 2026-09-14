import { defaultPaystackClient } from "@/src/integrations/paystack/client";
import { NotFoundError } from "@/lib/errors";
import * as paymentRepo from "@/src/modules/payment/repo";
import type { PaystackClient } from "@/src/modules/payment/types";

/**
 * Verify-then-act, every time — no webhook payload field (including
 * which *event type* it claimed to be) is ever trusted for a state
 * transition (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §9.2). Both
 * `charge.success` and `charge.failed` webhook deliveries call this SAME
 * function — Paystack's own Verify Transaction response, not the
 * webhook's claimed event type, decides the outcome. This is what
 * "successful payment processing" and "failed payment processing" both
 * actually resolve to internally; there is no separate code path that
 * trusts a `charge.failed` webhook's claim without independently
 * verifying it first.
 */

export type VerifyAndProcessOutcome =
  | { outcome: "ALREADY_RESOLVED"; currentStatus: string }
  | { outcome: "FAILED"; errorCode: string; transitioned: boolean }
  | {
      outcome: "SUCCESS";
      attemptTransitioned: boolean;
      orderTransitioned: boolean;
    }
  | { outcome: "VERIFICATION_INCONCLUSIVE" };

export async function verifyAndProcessPayment(
  attemptId: bigint,
  paystackClient: PaystackClient = defaultPaystackClient,
): Promise<VerifyAndProcessOutcome> {
  const attempt = await paymentRepo.findAttemptById(attemptId);
  if (!attempt) {
    throw new NotFoundError("Payment attempt not found.");
  }
  if (attempt.status !== "PENDING") {
    // Already resolved (by an earlier delivery, or a genuinely concurrent
    // one) — idempotent no-op, never re-verified once resolved.
    return { outcome: "ALREADY_RESOLVED", currentStatus: attempt.status };
  }

  let verified;
  try {
    verified = await paystackClient.verifyTransaction(
      attempt.paystackReference,
    );
  } catch {
    // Malformed response / network / timeout — plan §9.3: the attempt
    // stays PENDING, untouched; the caller (the webhook worker) retries
    // via its own attempt-count/backoff, never marks the attempt FAILED
    // for a transient verification problem.
    return { outcome: "VERIFICATION_INCONCLUSIVE" };
  }

  if (verified.status !== "success") {
    const { transitioned } = await paymentRepo.processFailedPayment({
      attemptId,
      errorCode: `VERIFICATION_STATUS_${verified.status.toUpperCase()}`,
      errorMessage: `Paystack reported this transaction's status as "${verified.status}".`,
    });
    return {
      outcome: "FAILED",
      errorCode: "VERIFICATION_STATUS",
      transitioned,
    };
  }

  if (verified.amountMinor !== attempt.amountMinor) {
    const { transitioned } = await paymentRepo.processFailedPayment({
      attemptId,
      errorCode: "AMOUNT_MISMATCH",
      errorMessage:
        "The verified payment amount did not match the expected order amount.",
    });
    return { outcome: "FAILED", errorCode: "AMOUNT_MISMATCH", transitioned };
  }

  if (verified.currency !== attempt.currency) {
    const { transitioned } = await paymentRepo.processFailedPayment({
      attemptId,
      errorCode: "CURRENCY_MISMATCH",
      errorMessage:
        "The verified payment currency did not match the expected order currency.",
    });
    return { outcome: "FAILED", errorCode: "CURRENCY_MISMATCH", transitioned };
  }

  const result = await paymentRepo.processSuccessfulPayment({
    attemptId,
    orderId: attempt.orderId,
    gatewayResponse: verified.gatewayResponse,
    channel: verified.channel,
    paidAt: verified.paidAt ? new Date(verified.paidAt) : new Date(),
  });

  return {
    outcome: "SUCCESS",
    attemptTransitioned: result.attemptTransitioned,
    orderTransitioned: result.orderTransitioned,
  };
}

import {
  PaystackApiError,
  PaystackConfigError,
  defaultPaystackClient,
} from "@/src/integrations/paystack/client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { env } from "@/lib/env";
import { generateGuestOrderToken } from "@/src/integrations/crypto/guest-order-token";
import * as orderRepo from "@/src/modules/order/repo";
import { GUEST_ORDER_TOKEN_TTL_SECONDS } from "@/src/modules/payment/constants";
import * as paymentRepo from "@/src/modules/payment/repo";
import type {
  InitializePaymentResult,
  PaystackClient,
} from "@/src/modules/payment/types";

/** Builds the URL Paystack's hosted checkout redirects the browser back
 * to — always carries `orderId` (so the payment-result page knows which
 * order to authoritatively re-check), and additionally a signed
 * `guestToken` for guest orders when `GUEST_ORDER_TOKEN_SECRET` is
 * configured (docs/PHASE_9_STOREFRONT_PLAN.md §13.1/§13.4 Option A).
 * Never includes anything Paystack-supplied — this URL is built entirely
 * from data this system already trusts. */
function buildPaymentResultCallbackUrl(
  orderId: bigint,
  isGuestOrder: boolean,
): string {
  const url = new URL(`${env.APP_BASE_URL}/checkout/payment-result`);
  url.searchParams.set("orderId", orderId.toString());
  if (isGuestOrder) {
    const token = generateGuestOrderToken(
      orderId,
      env.GUEST_ORDER_TOKEN_SECRET,
      GUEST_ORDER_TOKEN_TTL_SECONDS,
      new Date(),
    );
    if (token) {
      url.searchParams.set("guestToken", token);
    }
  }
  return url.toString();
}

/**
 * `INITIATED -> PENDING` (or `INITIALIZATION_FAILED`) — plan §8. Never
 * throws for a Paystack-side failure (config, network, API rejection):
 * every such failure resolves to the `INITIALIZATION_FAILED` outcome, so
 * the caller (checkout's own response flow, or "Retry Payment") never has
 * to distinguish "Paystack failed" from "a genuine bug" via a try/catch
 * of its own — only a precondition violation (attempt not found, wrong
 * state) throws, and callers are expected not to trigger those (this
 * use-case is always called immediately after creating a fresh
 * `INITIATED` attempt).
 *
 * Idempotent per attempt (plan §8.4/§18): a second call against an
 * attempt already `PENDING` does not call Paystack again — it returns
 * the existing `authorizationUrl`/`accessCode`.
 */
export async function initializePayment(
  attemptId: bigint,
  email: string,
  paystackClient: PaystackClient = defaultPaystackClient,
): Promise<InitializePaymentResult> {
  const attempt = await paymentRepo.findAttemptById(attemptId);
  if (!attempt) {
    throw new NotFoundError("Payment attempt not found.");
  }

  if (attempt.status === "PENDING") {
    if (attempt.authorizationUrl && attempt.accessCode) {
      return {
        outcome: "PENDING",
        authorizationUrl: attempt.authorizationUrl,
        accessCode: attempt.accessCode,
      };
    }
    // Structurally unreachable (PENDING is only ever set alongside both
    // fields), but verified rather than assumed.
    throw new ConflictError(
      "Payment attempt is pending but missing its authorization details.",
    );
  }

  if (attempt.status !== "INITIATED") {
    throw new ConflictError(
      `Payment attempt is not eligible for initialization (current status: ${attempt.status}).`,
    );
  }

  try {
    // Only to determine guest-vs-authenticated for the callback URL — a
    // plain, non-transactional read; never used for any authorization
    // decision here (this use-case has no actor at all).
    const order = await orderRepo.findOrderById(attempt.orderId);
    const callbackUrl = buildPaymentResultCallbackUrl(
      attempt.orderId,
      order?.userId === null,
    );

    const result = await paystackClient.initializeTransaction({
      amountMinor: attempt.amountMinor,
      email,
      reference: attempt.paystackReference,
      // docs/PHASE_9_STOREFRONT_PLAN.md §13.1/§31 — where Paystack's
      // hosted checkout redirects the browser back to after payment.
      // Additive: `callbackUrl` was already an optional field on
      // `InitializeTransactionParams` (Phase 8) but nothing populated it
      // until now; every existing test using a fake `PaystackClient` is
      // unaffected (it only asserts on the params it cares about).
      callbackUrl,
      metadata: { orderId: attempt.orderId.toString() },
    });

    const { transitioned } = await paymentRepo.markAttemptPending(attemptId, {
      authorizationUrl: result.authorizationUrl,
      accessCode: result.accessCode,
    });

    if (!transitioned) {
      // Lost a guard race against a genuinely concurrent duplicate call
      // (plan §8.4) — re-fetch and return whichever call actually won,
      // never silently discard this outcome.
      const current = await paymentRepo.findAttemptById(attemptId);
      if (
        current?.status === "PENDING" &&
        current.authorizationUrl &&
        current.accessCode
      ) {
        return {
          outcome: "PENDING",
          authorizationUrl: current.authorizationUrl,
          accessCode: current.accessCode,
        };
      }
      throw new ConflictError(
        "Payment attempt is no longer eligible for initialization.",
      );
    }

    return {
      outcome: "PENDING",
      authorizationUrl: result.authorizationUrl,
      accessCode: result.accessCode,
    };
  } catch (error) {
    if (error instanceof ConflictError) throw error;

    const errorCode =
      error instanceof PaystackApiError
        ? error.code
        : error instanceof PaystackConfigError
          ? "CONFIG_ERROR"
          : "UNKNOWN_ERROR";
    // PaystackApiError/PaystackConfigError messages are already sanitized
    // by construction (never a raw body, never a secret) — any other,
    // genuinely unexpected error gets a generic message here instead of
    // its own (potentially unsanitized) text.
    const errorMessage =
      error instanceof PaystackApiError || error instanceof PaystackConfigError
        ? error.message
        : "An unexpected error occurred while contacting Paystack.";

    await paymentRepo.markAttemptInitializationFailed(attemptId, {
      errorCode,
      errorMessage,
    });

    return { outcome: "INITIALIZATION_FAILED", errorCode, errorMessage };
  }
}

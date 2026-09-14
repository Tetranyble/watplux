import type { WebhookEvent } from "@prisma/client";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import * as paymentRepo from "@/src/modules/payment/repo";
import { verifyAndProcessPayment } from "@/src/modules/payment/use-cases/verify-and-process-payment";

/**
 * The entire webhook-worker orchestration lives here, in the use-case
 * layer — not in `src/jobs/process-webhook-events.ts` itself — because
 * the ESLint `boundaries/dependencies` rule forbids a `job` element from
 * importing a `repo` module directly ("Jobs orchestrate through
 * use-cases only"). The job file (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md
 * §14) is therefore a thin trigger that calls this one function.
 */

export interface ProcessWebhookEventBatchResult {
  claimed: number;
  processed: number;
  retried: number;
  failed: number;
}

function isChargeEvent(eventType: string): boolean {
  return eventType.startsWith("charge.");
}

function isRefundEvent(eventType: string): boolean {
  return eventType.startsWith("refund.");
}

/**
 * Refund-webhook processing is deliberately deferred
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §13.1/§18.2 — the disclosed,
 * unverified payload-shape risk; see the implementation report). The
 * event is still durably recorded and acknowledged (never left stuck
 * retrying forever for a reason that will never resolve itself) — it is
 * simply not acted upon. Refund *request/allocation/cancellation*
 * (`request-refund.ts`/`cancel-refund.ts`) are fully built and do not
 * depend on this.
 */
async function processRefundEvent(event: WebhookEvent): Promise<"PROCESSED"> {
  logger.warn(
    { webhookEventId: event.id.toString(), eventType: event.eventType },
    "Refund webhook processing is deferred pending live Paystack payload verification — event durably recorded but not acted on.",
  );
  await paymentRepo.recordWebhookEventOutcome(event.id, {
    status: "PROCESSED",
  });
  return "PROCESSED";
}

/**
 * Verify-then-act for every charge event, regardless of whether it
 * claimed to be `charge.success` or `charge.failed` — the webhook's own
 * claimed event type is never trusted (plan §9.2); only
 * `verifyAndProcessPayment`'s call to Paystack's Verify Transaction API
 * decides the outcome.
 */
async function processChargeEvent(
  event: WebhookEvent,
): Promise<"PROCESSED" | "RETRY" | "FAILED"> {
  const attempt = event.paystackReference
    ? await paymentRepo.findAttemptByReference(event.paystackReference)
    : null;

  if (!attempt) {
    // Nothing local to act on — durably recorded already; not an error.
    await paymentRepo.recordWebhookEventOutcome(event.id, {
      status: "PROCESSED",
    });
    return "PROCESSED";
  }

  const outcome = await verifyAndProcessPayment(attempt.id);

  if (outcome.outcome === "VERIFICATION_INCONCLUSIVE") {
    const attemptsExceeded =
      event.processingAttempts >= env.WEBHOOK_MAX_PROCESSING_ATTEMPTS;
    await paymentRepo.recordWebhookEventOutcome(event.id, {
      status: attemptsExceeded ? "FAILED" : "RETRY",
      errorMessage:
        "Paystack verification was inconclusive (malformed response, timeout, or network error).",
    });
    return attemptsExceeded ? "FAILED" : "RETRY";
  }

  await paymentRepo.recordWebhookEventOutcome(event.id, {
    status: "PROCESSED",
    resolvedPaymentAttemptId: attempt.id,
  });
  return "PROCESSED";
}

async function processOneWebhookEvent(
  event: WebhookEvent,
): Promise<"PROCESSED" | "RETRY" | "FAILED"> {
  if (isRefundEvent(event.eventType)) {
    return processRefundEvent(event);
  }
  if (isChargeEvent(event.eventType)) {
    return processChargeEvent(event);
  }
  // Unrecognized event type — durably recorded already; nothing to act on.
  await paymentRepo.recordWebhookEventOutcome(event.id, {
    status: "PROCESSED",
  });
  return "PROCESSED";
}

/**
 * One worker pass (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §14): scans for
 * claimable rows, attempts to individually claim each one (the guarded
 * `UPDATE` — a loss here just means another worker/run already claimed
 * it, not an error), and processes only the ones this call actually won.
 * Crash-safe by construction: every step between claim and outcome is
 * either idempotent or safely reclaimable after the staleness timeout
 * (plan §14.2).
 */
export async function processWebhookEventBatch(
  batchSize = 20,
): Promise<ProcessWebhookEventBatchResult> {
  const candidateIds =
    await paymentRepo.findClaimableWebhookEventIds(batchSize);

  const result: ProcessWebhookEventBatchResult = {
    claimed: 0,
    processed: 0,
    retried: 0,
    failed: 0,
  };

  for (const id of candidateIds) {
    const won = await paymentRepo.claimWebhookEvent(id);
    if (!won) continue;
    result.claimed += 1;

    const event = await paymentRepo.findWebhookEventById(id);
    if (!event) continue; // unreachable in practice; verified, not assumed

    try {
      const outcome = await processOneWebhookEvent(event);
      if (outcome === "PROCESSED") result.processed += 1;
      else if (outcome === "RETRY") result.retried += 1;
      else result.failed += 1;
    } catch (error) {
      logger.error(
        { err: error, webhookEventId: event.id.toString() },
        "Webhook event processing threw an unexpected error",
      );
      const attemptsExceeded =
        event.processingAttempts >= env.WEBHOOK_MAX_PROCESSING_ATTEMPTS;
      await paymentRepo.recordWebhookEventOutcome(id, {
        status: attemptsExceeded ? "FAILED" : "RETRY",
        errorMessage:
          error instanceof Error ? error.message : "Unknown processing error.",
      });
      if (attemptsExceeded) result.failed += 1;
      else result.retried += 1;
    }
  }

  return result;
}

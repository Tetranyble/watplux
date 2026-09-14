import { ForbiddenError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PAYMENTS_READ } from "@/src/modules/payment/constants";
import * as paymentRepo from "@/src/modules/payment/repo";
import { toPaymentAttemptRecord } from "@/src/modules/payment/types";
import type { PaymentAttemptRecord } from "@/src/modules/payment/types";

export interface ReconciliationFlags {
  /** SUCCESS attempts that are not (or no longer) their order's
   * authoritative attempt — covers both a genuine double payment and a
   * late payment after cancellation (plan §11/§17/§23). */
  nonAuthoritativeSuccessfulAttempts: PaymentAttemptRecord[];
  /** Attempts stuck in `INITIATED` past a threshold — the Initialize
   * call may have crashed mid-flight (plan §9.1/§23). */
  stuckInitiatedAttempts: PaymentAttemptRecord[];
  /** Webhook events that exhausted their processing-attempt budget, or
   * are mid-reclaim past the staleness window (plan §14/§23). */
  stuckOrFailedWebhookEventIds: string[];
  /** Refund requests allocated but never resolved past a threshold
   * (plan §19/§23). */
  stuckRefundIds: string[];
}

const STUCK_INITIATED_THRESHOLD_MINUTES = 30;
const STUCK_REFUND_THRESHOLD_MINUTES = 24 * 60;

/** Read-only, `payments.read`-gated backend capability — no admin UI is
 * built in this phase (plan §23/§31). */
export async function listReconciliationFlags(
  actor: AuthenticatedUser,
): Promise<ReconciliationFlags> {
  if (!actor.permissions.has(PERMISSION_PAYMENTS_READ)) {
    throw new ForbiddenError(
      "You do not have permission to view reconciliation data.",
    );
  }

  const [nonAuthoritative, stuckInitiated, stuckWebhooks, stuckRefunds] =
    await Promise.all([
      paymentRepo.listNonAuthoritativeSuccessfulAttempts(),
      paymentRepo.listStuckInitiatedAttempts(STUCK_INITIATED_THRESHOLD_MINUTES),
      paymentRepo.listStuckOrFailedWebhookEvents(),
      paymentRepo.listStuckRefunds(STUCK_REFUND_THRESHOLD_MINUTES),
    ]);

  return {
    nonAuthoritativeSuccessfulAttempts: nonAuthoritative.map(
      toPaymentAttemptRecord,
    ),
    stuckInitiatedAttempts: stuckInitiated.map(toPaymentAttemptRecord),
    stuckOrFailedWebhookEventIds: stuckWebhooks.map((w) => w.id.toString()),
    stuckRefundIds: stuckRefunds.map((r) => r.id.toString()),
  };
}

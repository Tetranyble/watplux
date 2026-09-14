import { processWebhookEventBatch } from "@/src/modules/payment/use-cases/process-webhook-event-batch";
import type { ProcessWebhookEventBatchResult } from "@/src/modules/payment/use-cases/process-webhook-event-batch";

/**
 * The async Paystack-webhook worker (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md
 * §14) — MySQL-backed durability only, no in-memory queue, no Redis.
 * Free of any `next/*` dependency — callable directly from a script, a
 * test, or (via `app/api/internal/process-webhook-events/route.ts`) an
 * authenticated internal trigger endpoint invoked by an external cron
 * scheduler (plan §16, matching `ARCHITECTURE.md` §15's own "cron hitting
 * an internal authenticated endpoint" MVP design).
 *
 * All repo-touching orchestration lives in
 * `payment/use-cases/process-webhook-event-batch.ts` — this file is a
 * thin trigger only, per the ESLint `boundaries/dependencies` rule
 * ("Jobs orchestrate through use-cases only — they cannot import a repo
 * ... module directly").
 */
export async function runWebhookWorker(
  batchSize?: number,
): Promise<ProcessWebhookEventBatchResult> {
  return processWebhookEventBatch(batchSize);
}

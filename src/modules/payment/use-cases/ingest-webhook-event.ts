import type { Prisma } from "@prisma/client";

import { env } from "@/lib/env";
import { verifyPaystackSignature } from "@/src/integrations/paystack/signature";
import * as paymentRepo from "@/src/modules/payment/repo";

/**
 * Durable ingestion ONLY — no verification, no business state transition
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §12). The route handler calling
 * this is the ONLY database write on the ingestion path; everything else
 * happens asynchronously via the worker
 * (`process-webhook-event-batch.ts`).
 */

export interface IngestWebhookEventInput {
  rawBody: string;
  signatureHeader: string | null;
}

export type IngestWebhookEventResult =
  | { outcome: "ACCEPTED"; alreadyRecorded: boolean }
  | { outcome: "INVALID_SIGNATURE" }
  | { outcome: "MALFORMED" }
  | { outcome: "NOT_CONFIGURED" };

export async function ingestWebhookEvent(
  input: IngestWebhookEventInput,
  secretOverride?: string | null,
): Promise<IngestWebhookEventResult> {
  const secret =
    secretOverride === null
      ? undefined
      : (secretOverride ?? env.PAYSTACK_SECRET_KEY);
  if (!secret) {
    // Fail closed — never accept an unverifiable webhook just because
    // the deployment hasn't configured a secret key yet.
    return { outcome: "NOT_CONFIGURED" };
  }

  if (!verifyPaystackSignature(input.rawBody, input.signatureHeader, secret)) {
    return { outcome: "INVALID_SIGNATURE" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { outcome: "MALFORMED" };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("event" in parsed) ||
    !("data" in parsed)
  ) {
    return { outcome: "MALFORMED" };
  }

  const eventType = (parsed as { event: unknown }).event;
  const data = (parsed as { data: unknown }).data;
  if (
    typeof eventType !== "string" ||
    typeof data !== "object" ||
    data === null
  ) {
    return { outcome: "MALFORMED" };
  }

  const dataObj = data as Record<string, unknown>;
  const transactionId = dataObj.id;
  if (transactionId === undefined || transactionId === null) {
    // Plan §13.1's disclosed, unverified risk: this codebase does not
    // yet know for certain that every event type it will ever receive
    // carries `data.id`. Rather than inventing a fallback speculatively,
    // an event missing it is rejected as malformed and logged for
    // investigation — the documented hash-based fallback (plan §13.1) is
    // built only if this is ever actually observed against a real
    // payload, not before.
    return { outcome: "MALFORMED" };
  }

  const reference =
    typeof dataObj.reference === "string" ? dataObj.reference : null;

  const { inserted } = await paymentRepo.insertWebhookEvent({
    eventType,
    paystackTransactionId: String(transactionId),
    paystackReference: reference,
    rawPayload: parsed as Prisma.InputJsonValue,
  });

  return { outcome: "ACCEPTED", alreadyRecorded: !inserted };
}

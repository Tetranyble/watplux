import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import {
  readTextBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/http-body";
import { ingestWebhookEvent } from "@/src/modules/payment/use-cases/ingest-webhook-event";

/**
 * The webhook Route Handler (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §12) —
 * the ONLY database write here is the durable `webhook_events` insert.
 * This route must NEVER: call Paystack's Verify Transaction API, mark an
 * order `PAID`, mutate inventory, process a refund, or execute any
 * long-running logic — every one of those lives in the async worker
 * (`src/jobs/process-webhook-events.ts`), never here.
 *
 * Reads the raw body as bytes (not parsed JSON) for signature
 * verification (plan §21) — re-serializing a parsed body can alter
 * whitespace/key order and invalidate the signature.
 */
export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await readTextBodyWithLimit(request, 256 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Payload too large." },
        { status: 413 },
      );
    }
    return NextResponse.json(
      { error: "Could not read request body." },
      { status: 400 },
    );
  }

  try {
    const result = await ingestWebhookEvent({
      rawBody,
      signatureHeader: request.headers.get("x-paystack-signature"),
    });

    switch (result.outcome) {
      case "ACCEPTED":
        return NextResponse.json({ received: true }, { status: 200 });
      case "INVALID_SIGNATURE":
        return NextResponse.json(
          { error: "Invalid signature." },
          { status: 401 },
        );
      case "MALFORMED":
        return NextResponse.json(
          { error: "Malformed payload." },
          { status: 400 },
        );
      case "NOT_CONFIGURED":
        return NextResponse.json(
          { error: "Webhook processing is not configured." },
          { status: 503 },
        );
    }
  } catch (error) {
    // A genuinely unexpected failure (e.g. a transient DB error) — a
    // real 500 here is the CORRECT outcome: it makes Paystack retry per
    // its own delivery schedule, rather than us swallowing a failure
    // that would otherwise silently lose the event.
    logger.error({ err: error }, "Unexpected error ingesting Paystack webhook");
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}

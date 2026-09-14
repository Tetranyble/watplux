import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { processWebhookEventBatch } from "@/src/modules/payment/use-cases/process-webhook-event-batch";
import { getWebhookWorkerHealth } from "@/src/modules/payment/use-cases/get-webhook-worker-health";
import { safeEqualSecret } from "@/lib/request-security";

/**
 * Machine-to-machine only — never ordinary user-session authentication
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §16). An external scheduler
 * (platform cron, or a container-level cron per `ARCHITECTURE.md` §15's
 * Docker deployment target) invokes this on a short interval, matching
 * `ARCHITECTURE.md` §15's own "cron hitting an internal authenticated
 * endpoint" MVP design.
 *
 * Calls the use-case directly — never `src/jobs/process-webhook-events.ts`
 * itself: `app/**` (presentation) is disallowed by the ESLint
 * `boundaries/dependencies` rule from importing a `job`-typed element
 * directly, the same restriction that keeps presentation code going
 * through a use-case for repo/domain access. The job file is instead the
 * standalone, non-HTTP invocation path (a script-driven cron running it
 * directly, with zero `next/*` dependency) — both converge on the same
 * use-case.
 *
 * Fails closed: if `INTERNAL_WORKER_SECRET` is not configured, every
 * request is rejected — never silently allowing unauthenticated access
 * because a deployment forgot to set the secret.
 */
export async function POST(request: Request) {
  if (!env.INTERNAL_WORKER_SECRET) {
    return NextResponse.json(
      { error: "The internal worker trigger is not configured." },
      { status: 503 },
    );
  }

  const providedSecret = request.headers.get("x-internal-worker-secret");
  if (!safeEqualSecret(providedSecret, env.INTERNAL_WORKER_SECRET)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await processWebhookEventBatch();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error({ err: error }, "Webhook worker run failed unexpectedly");
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!env.INTERNAL_WORKER_SECRET) {
    return NextResponse.json(
      { error: "The internal worker trigger is not configured." },
      { status: 503 },
    );
  }
  if (
    !safeEqualSecret(
      request.headers.get("x-internal-worker-secret"),
      env.INTERNAL_WORKER_SECRET,
    )
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const health = await getWebhookWorkerHealth();
    return NextResponse.json(health, {
      status: health.status === "healthy" ? 200 : 503,
    });
  } catch (error) {
    logger.error({ err: error }, "Webhook worker health check failed");
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}

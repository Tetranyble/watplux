import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { listReconciliationFlags } from "@/src/modules/payment/use-cases/list-reconciliation-flags";

/** `payments.read`-gated backend reconciliation capability — no admin UI
 * is built in this phase (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §23/§31). */
export async function GET() {
  try {
    const actor = await requireSessionUser();
    const flags = await listReconciliationFlags(actor);
    return NextResponse.json({ flags });
  } catch (error) {
    return errorResponse(error);
  }
}
